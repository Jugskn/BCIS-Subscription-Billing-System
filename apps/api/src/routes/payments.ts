import { createReadStream } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import {
  allocationPreviewSchema,
  centavosToString,
  paymentListQuerySchema,
  postPaymentSchema,
  recordGCashSchema,
  rejectGCashSchema,
  reversePaymentSchema,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import {
  assertProofMime,
  assertProofSize,
  storeProofFile,
} from "../lib/proof-storage.js";
import {
  getPayment,
  getProofPath,
  getReceipt,
  getSubscriberOpenBalance,
  listPendingGCash,
  listPayments,
  postPayment,
  previewPaymentAllocation,
  recordGCashPending,
  rejectGCashPayment,
  reversePayment,
  verifyGCashPayment,
} from "../services/payment-service.js";
import { getProofUploadLimits } from "../services/settings-service.js";

type PaymentsRouteOpts = {
  uploadDir: string;
  maxProofBytes: number;
};

const paymentRoutes: FastifyPluginAsync<PaymentsRouteOpts> = async (
  app,
  opts,
) => {
  await app.register(multipart, {
    limits: { fileSize: opts.maxProofBytes, files: 1 },
  });

  app.get(
    "/payments",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = paymentListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid list query.");
      }
      return listPayments(app.db, parsed.data);
    },
  );

  app.get(
    "/payments/gcash/pending",
    { preHandler: [app.requirePermission("gcash.verify")] },
    async (request) => {
      const parsed = paymentListQuerySchema.pick({ page: true, pageSize: true }).safeParse(
        request.query,
      );
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid list query.");
      }
      return listPendingGCash(app.db, parsed.data);
    },
  );

  app.get(
    "/payments/:id",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return getPayment(app.db, id);
    },
  );

  app.get(
    "/subscribers/:id/open-balance",
    { preHandler: [app.requirePermission("payment.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const balance = await getSubscriberOpenBalance(app.db, id);
      return { subscriberId: id, openBalanceCentavos: centavosToString(balance) };
    },
  );

  app.post(
    "/payments/preview",
    { preHandler: [app.requirePermission("payment.create")] },
    async (request) => {
      const parsed = allocationPreviewSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid allocation preview.");
      }
      const allowManual = request.user.permissions.includes("payment.allocate_manual");
      if (parsed.data.allocations?.length && !allowManual) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Manual allocation requires payment.allocate_manual permission.",
        );
      }
      return previewPaymentAllocation(app.db, {
        subscriberId: parsed.data.subscriberId,
        amountCentavos: parsed.data.amount,
        manual: parsed.data.allocations?.map((a) => ({
          invoiceId: a.invoiceId,
          amountCentavos: a.amount,
        })),
      });
    },
  );

  app.post(
    "/payments",
    { preHandler: [app.requirePermission("payment.create")] },
    async (request, reply) => {
      const parsed = postPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid payment payload.");
      }
      if (parsed.data.amount <= 0n) {
        throw new AppError(400, "VALIDATION_ERROR", "Payment amount must be greater than zero.");
      }
      const allowManual = request.user.permissions.includes("payment.allocate_manual");
      const result = await postPayment(app.db, request.user.id, {
        subscriberId: parsed.data.subscriberId,
        amountCentavos: parsed.data.amount,
        method: parsed.data.method,
        receivedAt: parsed.data.receivedAt
          ? new Date(parsed.data.receivedAt)
          : undefined,
        referenceNumber: parsed.data.referenceNumber,
        notes: parsed.data.notes,
        idempotencyKey: parsed.data.idempotencyKey,
        allowManual,
        manual: parsed.data.allocations?.map((a) => ({
          invoiceId: a.invoiceId,
          amountCentavos: a.amount,
        })),
      });
      return reply.code(result.replayed ? 200 : 201).send({
        payment: result.payment,
        receipt: result.receipt,
      });
    },
  );

  app.post(
    "/payments/gcash",
    { preHandler: [app.requirePermission("payment.create")] },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        throw new AppError(400, "VALIDATION_ERROR", "Proof file is required.");
      }

      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(data.fields)) {
        if (value && typeof value === "object" && "value" in value) {
          fields[key] = String((value as { value: unknown }).value);
        }
      }

      const parsed = recordGCashSchema.safeParse({
        subscriberId: fields.subscriberId,
        amount: fields.amount,
        referenceNumber: fields.referenceNumber,
        senderName: fields.senderName,
        notes: fields.notes,
        idempotencyKey: fields.idempotencyKey,
      });
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid GCash payment payload.");
      }

      const buffer = await data.toBuffer();
      const limits = await getProofUploadLimits(app.db);
      const maxBytes = Math.min(opts.maxProofBytes, limits.maxBytes);
      const mimeOk =
        (data.mimetype === "image/jpeg" && limits.allowedTypes.includes("jpg")) ||
        (data.mimetype === "image/png" && limits.allowedTypes.includes("png")) ||
        (data.mimetype === "application/pdf" &&
          limits.allowedTypes.includes("pdf"));
      if (!mimeOk) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          `Proof must be one of: ${limits.allowedTypes.join(", ")}.`,
        );
      }
      assertProofMime(data.mimetype);
      assertProofSize(buffer.length, maxBytes);

      const stored = await storeProofFile({
        uploadDir: opts.uploadDir,
        mimeType: data.mimetype,
        content: buffer,
        originalFilename: data.filename,
      });

      const result = await recordGCashPending(app.db, request.user.id, {
        subscriberId: parsed.data.subscriberId,
        amountCentavos: parsed.data.amount,
        referenceNumber: parsed.data.referenceNumber,
        senderName: parsed.data.senderName,
        notes: parsed.data.notes,
        idempotencyKey: parsed.data.idempotencyKey,
        proof: stored,
      });

      return reply.code(result.replayed ? 200 : 201).send(result.payment);
    },
  );

  app.post(
    "/payments/:id/verify",
    { preHandler: [app.requirePermission("gcash.verify")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const allowManual = request.user.permissions.includes("payment.allocate_manual");
      return verifyGCashPayment(app.db, request.user.id, id, allowManual);
    },
  );

  app.post(
    "/payments/:id/reject",
    { preHandler: [app.requirePermission("gcash.reject")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = rejectGCashSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Rejection reason is required.");
      }
      return rejectGCashPayment(app.db, request.user.id, id, parsed.data.reason);
    },
  );

  app.post(
    "/payments/:id/reverse",
    { preHandler: [app.requirePermission("payment.reverse")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = reversePaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Reversal reason is required.");
      }
      return reversePayment(app.db, request.user.id, id, parsed.data.reason);
    },
  );

  app.get(
    "/receipts/:id",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return getReceipt(app.db, id);
    },
  );

  app.get(
    "/payment-proofs/:id",
    {
      preHandler: [
        async (request, reply) => {
          await app.authenticate(request, reply);
          const perms = request.user.permissions;
          if (
            !perms.includes("gcash.verify") &&
            !perms.includes("gcash.reject") &&
            !perms.includes("receivable.view")
          ) {
            throw new AppError(
              403,
              "FORBIDDEN",
              "You do not have permission to perform this action.",
            );
          }
        },
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const proof = await getProofPath(app.db, id);
      reply.header("Content-Type", proof.mimeType);
      reply.header(
        "Content-Disposition",
        `inline; filename="${proof.originalFilename.replace(/"/g, "")}"`,
      );
      return reply.send(createReadStream(proof.storagePath));
    },
  );
};

export default paymentRoutes;
