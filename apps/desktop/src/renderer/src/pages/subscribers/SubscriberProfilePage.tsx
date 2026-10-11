import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  InvoiceListItem,
  LedgerEntryItem,
  PaymentListItem,
  SubscriberDetail,
} from "@bcis/shared";
import {
  formatCentavos,
  formatPhilippineMobile,
  philippineMobileSchema,
} from "@bcis/shared";
import {
  AsyncCombobox,
  type AsyncComboboxOption,
} from "@/components/async-combobox";
import { StatusBadge } from "@/components/status-badge";
import { TabEmptyState } from "@/components/tab-empty-state";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  ApiClientError,
  applyApiFieldErrors,
  type SubscriberCollectionHistory,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const editSchema = z.object({
  fullName: z.string().min(1, "Full name is required."),
  contactPhone: philippineMobileSchema.or(z.literal("")),
  contactEmail: z.string().email().optional().or(z.literal("")),
  address: z.string().min(1, "Address is required."),
  collectionAreaId: z.string().optional(),
  collectorUserId: z.string().optional(),
  dueDay: z.number().int().min(1).max(28),
  notes: z.string().optional(),
});

type EditForm = z.infer<typeof editSchema>;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Services" },
  { id: "billing", label: "Billing" },
  { id: "payments", label: "Payments" },
  { id: "ledger", label: "Ledger" },
  { id: "collection", label: "Collection" },
  { id: "history", label: "Service History" },
  { id: "documents", label: "Documents" },
  { id: "audit", label: "Audit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SubscriberProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [areaLabel, setAreaLabel] = useState("");
  const [collectorLabel, setCollectorLabel] = useState("");

  const subscriberQuery = useQuery({
    queryKey: ["subscriber", id],
    queryFn: () => api.getSubscriber(id!),
    enabled: Boolean(id),
  });

  const servicesQuery = useQuery({
    queryKey: ["service-accounts", id],
    queryFn: () =>
      api.listServiceAccounts({ subscriberId: id, page: 1, pageSize: 50 }),
    enabled: Boolean(id) && (tab === "services" || tab === "history"),
  });

  const invoicesQuery = useQuery({
    queryKey: ["subscriber-invoices", id],
    queryFn: () => api.listInvoices({ subscriberId: id, page: 1, pageSize: 50 }),
    enabled: Boolean(id) && tab === "billing" && can("receivable.view"),
  });

  const ledgerQuery = useQuery({
    queryKey: ["subscriber-ledger", id],
    queryFn: () => api.listSubscriberLedger(id!, { page: 1, pageSize: 100 }),
    enabled: Boolean(id) && tab === "ledger" && can("receivable.view"),
  });

  const paymentsQuery = useQuery({
    queryKey: ["subscriber-payments", id],
    queryFn: () =>
      api.listPayments({ subscriberId: id, page: 1, pageSize: 100 }),
    enabled: Boolean(id) && tab === "payments" && can("receivable.view"),
  });

  const collectionQuery = useQuery({
    queryKey: ["subscriber-collections", id],
    queryFn: () => api.getSubscriberCollectionHistory(id!),
    enabled: Boolean(id) && tab === "collection",
  });

  const documentsQuery = useQuery({
    queryKey: ["subscriber-documents", id],
    queryFn: () => api.getSubscriberDocuments(id!, { page: 1, pageSize: 100 }),
    enabled: Boolean(id) && tab === "documents" && can("receivable.view"),
  });

  const auditQuery = useQuery({
    queryKey: ["subscriber-audit", id],
    queryFn: () => api.getSubscriberAudit(id!, { page: 1, pageSize: 100 }),
    enabled: Boolean(id) && tab === "audit" && can("audit.view"),
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      fullName: "",
      contactPhone: "",
      contactEmail: "",
      address: "",
      collectionAreaId: "",
      collectorUserId: "",
      dueDay: 15,
      notes: "",
    },
  });

  const loadAreas = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.areaOptions(search || undefined);
      return items.map((a) => ({
        value: a.id,
        label: `${a.code} — ${a.name}`,
      }));
    },
    [api],
  );

  const loadCollectors = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.collectorOptions(search || undefined);
      return items.map((c) => ({
        value: c.id,
        label: `${c.fullName} (${c.username})`,
      }));
    },
    [api],
  );

  const openEdit = (sub: SubscriberDetail) => {
    setEditError(null);
    editForm.reset({
      fullName: sub.fullName,
      contactPhone: sub.contactPhone ?? "",
      contactEmail: sub.contactEmail ?? "",
      address: sub.address,
      collectionAreaId: sub.collectionAreaId ?? "",
      collectorUserId: sub.collectorUserId ?? "",
      dueDay: sub.dueDay,
      notes: sub.notes ?? "",
    });
    setAreaLabel(sub.collectionAreaName ?? "");
    setCollectorLabel(sub.collectorName ?? "");
    setEditOpen(true);
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.updateSubscriber(id!, { status: status as "INACTIVE" | "TERMINATED" | "ARCHIVED" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["subscriber", id] });
      await qc.invalidateQueries({ queryKey: ["subscribers"] });
      toast.success("Subscriber status updated.");
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (values: EditForm) =>
      api.updateSubscriber(id!, {
        fullName: values.fullName,
        contactPhone: values.contactPhone || undefined,
        contactEmail: values.contactEmail || undefined,
        address: values.address,
        collectionAreaId: values.collectionAreaId || null,
        collectorUserId: values.collectorUserId || null,
        dueDay: values.dueDay,
        notes: values.notes || undefined,
      }),
    onSuccess: async () => {
      setEditOpen(false);
      setEditError(null);
      await qc.invalidateQueries({ queryKey: ["subscriber", id] });
      await qc.invalidateQueries({ queryKey: ["subscribers"] });
      toast.success("Subscriber updated.");
    },
    onError: (err) => {
      setEditError(applyApiFieldErrors(editForm.setError, err));
    },
  });

  const subscriber = subscriberQuery.data;
  if (subscriberQuery.isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (subscriberQuery.isError || !subscriber) {
    return (
      <p className="text-sm text-danger">
        {subscriberQuery.error instanceof ApiClientError
          ? subscriberQuery.error.message
          : "Subscriber not found."}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link to="/subscribers" className="text-burgundy hover:underline">
              Subscribers
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            {subscriber.fullName}
          </h1>
          <p className="mt-1 font-mono text-sm text-muted">
            {subscriber.accountNumber}
          </p>
          <div className="mt-2">
            <StatusBadge status={subscriber.status} />
          </div>
        </div>
        <div className="flex gap-2">
          {can("subscriber.update") ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openEdit(subscriber)}
            >
              Edit
            </Button>
          ) : null}
          {can("subscriber.deactivate") && subscriber.status === "ACTIVE" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate("INACTIVE")}
              >
                Mark inactive
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate("TERMINATED")}
              >
                Terminate
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              "px-4 py-2 text-sm",
              tab === t.id
                ? "border-b-2 border-burgundy font-medium text-burgundy"
                : "text-muted hover:text-ink",
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <dl className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field
            label="Contact phone"
            value={formatPhilippineMobile(subscriber.contactPhone)}
          />
          <Field label="Email" value={subscriber.contactEmail} />
          <Field label="Address" value={subscriber.address} />
          <Field label="Collection area" value={subscriber.collectionAreaName} />
          <Field label="Collector" value={subscriber.collectorName} />
          <Field label="Due day" value={String(subscriber.dueDay)} />
          <Field label="Notes" value={subscriber.notes} className="sm:col-span-2" />
        </dl>
      ) : null}

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditError(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit subscriber</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={editForm.handleSubmit((values) => {
              setEditError(null);
              updateMutation.mutate(values);
            })}
          >
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input {...editForm.register("fullName")} />
              {editForm.formState.errors.fullName ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.fullName.message}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact phone</Label>
                <Input
                  placeholder="09XX XXX XXXX"
                  {...editForm.register("contactPhone")}
                />
                {editForm.formState.errors.contactPhone ? (
                  <p className="text-sm text-danger">
                    {editForm.formState.errors.contactPhone.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" {...editForm.register("contactEmail")} />
                {editForm.formState.errors.contactEmail ? (
                  <p className="text-sm text-danger">
                    {editForm.formState.errors.contactEmail.message}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input {...editForm.register("address")} />
              {editForm.formState.errors.address ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.address.message}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Collection area</Label>
                <Controller
                  control={editForm.control}
                  name="collectionAreaId"
                  render={({ field }) => (
                    <AsyncCombobox
                      value={field.value ?? ""}
                      selectedLabel={areaLabel}
                      loadOptions={loadAreas}
                      placeholder="Search area…"
                      onChange={(v, opt) => {
                        field.onChange(v);
                        setAreaLabel(opt?.label ?? "");
                      }}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Collector</Label>
                <Controller
                  control={editForm.control}
                  name="collectorUserId"
                  render={({ field }) => (
                    <AsyncCombobox
                      value={field.value ?? ""}
                      selectedLabel={collectorLabel}
                      loadOptions={loadCollectors}
                      placeholder="Search collector…"
                      onChange={(v, opt) => {
                        field.onChange(v);
                        setCollectorLabel(opt?.label ?? "");
                      }}
                    />
                  )}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Due day</Label>
              <Input
                type="number"
                min={1}
                max={28}
                {...editForm.register("dueDay", { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input {...editForm.register("notes")} />
            </div>
            {editError ? <p className="text-sm text-danger">{editError}</p> : null}
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {tab === "services" ? (
        <div className="space-y-3">
          {(servicesQuery.data?.items ?? []).length === 0 ? (
            <TabEmptyState
              title="No service accounts"
              description="Add a service account from the Service Accounts page."
            />
          ) : (
            <div className="overflow-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-surface">
                  <tr className="border-b border-border text-left text-muted">
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(servicesQuery.data?.items ?? []).map((sa) => (
                    <tr key={sa.id} className="border-b border-border">
                      <td className="px-3 py-2 font-mono">{sa.accountNumber}</td>
                      <td className="px-3 py-2">{sa.planName}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatCentavos(BigInt(sa.currentRateCentavos))}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={sa.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        <ServiceHistoryTab accounts={servicesQuery.data?.items ?? []} />
      ) : null}

      {tab === "billing" ? (
        <SubscriberBillingTab
          invoices={invoicesQuery.data?.items ?? []}
          loading={invoicesQuery.isLoading}
          canView={can("receivable.view")}
        />
      ) : null}

      {tab === "payments" ? (
        <SubscriberPaymentsTab
          payments={paymentsQuery.data?.items ?? []}
          loading={paymentsQuery.isLoading}
          canView={can("receivable.view")}
        />
      ) : null}

      {tab === "ledger" ? (
        <SubscriberLedgerTab
          entries={ledgerQuery.data?.items ?? []}
          loading={ledgerQuery.isLoading}
          canView={can("receivable.view")}
        />
      ) : null}

      {tab === "collection" ? (
        <SubscriberCollectionTab
          data={collectionQuery.data}
          loading={collectionQuery.isLoading}
          error={
            collectionQuery.isError
              ? collectionQuery.error instanceof ApiClientError
                ? collectionQuery.error.message
                : "Could not load collection history."
              : null
          }
        />
      ) : null}

      {tab === "documents" ? (
        <SubscriberDocumentsTab
          items={documentsQuery.data?.items ?? []}
          loading={documentsQuery.isLoading}
          canView={can("receivable.view")}
          error={
            documentsQuery.isError
              ? documentsQuery.error instanceof ApiClientError
                ? documentsQuery.error.message
                : "Could not load documents."
              : null
          }
          onPreviewProof={async (proofId) => {
            try {
              const blob = await api.fetchProofBlob(proofId);
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank", "noopener,noreferrer");
            } catch (err) {
              toast.error(
                err instanceof ApiClientError
                  ? err.message
                  : "Could not open proof.",
              );
            }
          }}
        />
      ) : null}

      {tab === "audit" ? (
        <SubscriberAuditTab
          items={auditQuery.data?.items ?? []}
          loading={auditQuery.isLoading}
          canView={can("audit.view")}
          error={
            auditQuery.isError
              ? auditQuery.error instanceof ApiClientError
                ? auditQuery.error.message
                : "Could not load audit trail."
              : null
          }
        />
      ) : null}
    </div>
  );
}

function SubscriberCollectionTab({
  data,
  loading,
  error,
}: {
  data: SubscriberCollectionHistory | undefined;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <p className="text-sm text-muted">Loading collection history…</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-border bg-surface p-3">
          <p className="text-sm text-muted">Assigned collector</p>
          <p className="mt-1 font-medium text-ink">
            {data.assignedCollector?.name ?? "Unassigned"}
          </p>
        </div>
        <div className="border border-border bg-surface p-3">
          <p className="text-sm text-muted">Collection area</p>
          <p className="mt-1 font-medium text-ink">
            {data.assignedArea
              ? `${data.assignedArea.code} — ${data.assignedArea.name}`
              : "Unassigned"}
          </p>
        </div>
      </div>

      {data.items.length === 0 ? (
        <TabEmptyState
          title="No collection history"
          description="This subscriber has not appeared in a collection batch yet."
        />
      ) : (
        <div className="overflow-auto border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Batch</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Collected</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.batchAccountId} className="border-b border-border">
                  <td className="px-3 py-2">
                    {new Date(item.recordedAt).toLocaleDateString("en-PH")}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/collections/batches/${item.batchId}`}
                      className="text-burgundy hover:underline"
                    >
                      {item.batchNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={item.batchStatus} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCentavos(BigInt(item.expectedCentavos))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCentavos(BigInt(item.collectedCentavos))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}

function SubscriberBillingTab({
  invoices,
  loading,
  canView,
}: {
  invoices: InvoiceListItem[];
  loading: boolean;
  canView: boolean;
}) {
  if (!canView) {
    return (
      <TabEmptyState
        title="Billing unavailable"
        description="You do not have permission to view invoices."
      />
    );
  }
  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (invoices.length === 0) {
    return (
      <TabEmptyState
        title="No invoices"
        description="Invoices appear after billing is generated for this subscriber."
      />
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-surface">
          <tr className="border-b border-border text-left text-muted">
            <th className="px-3 py-2">Invoice</th>
            <th className="px-3 py-2">Period</th>
            <th className="px-3 py-2">Due</th>
            <th className="px-3 py-2 text-right">Balance</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-border">
              <td className="px-3 py-2">
                <Link
                  to={`/billing/invoices/${inv.id}`}
                  className="font-mono text-burgundy hover:underline"
                >
                  {inv.invoiceNumber}
                </Link>
              </td>
              <td className="px-3 py-2">{inv.billingPeriod}</td>
              <td className="px-3 py-2">{inv.dueDate}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCentavos(BigInt(inv.balanceCentavos))}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={inv.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriberPaymentsTab({
  payments,
  loading,
  canView,
}: {
  payments: PaymentListItem[];
  loading: boolean;
  canView: boolean;
}) {
  if (!canView) {
    return (
      <TabEmptyState
        title="Payments unavailable"
        description="You do not have permission to view payments."
      />
    );
  }
  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (payments.length === 0) {
    return (
      <TabEmptyState
        title="No payments"
        description="Payments posted for this subscriber will appear here."
      />
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-surface">
          <tr className="border-b border-border text-left text-muted">
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Receipt</th>
            <th className="px-3 py-2">Method</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b border-border">
              <td className="px-3 py-2">
                {new Date(p.receivedAt).toLocaleDateString("en-PH")}
              </td>
              <td className="px-3 py-2">
                {p.receiptId ? (
                  <Link
                    to={`/payments/receipts/${p.receiptId}`}
                    className="font-mono text-burgundy hover:underline"
                  >
                    {p.receiptNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">{p.method}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCentavos(BigInt(p.amountCentavos))}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriberLedgerTab({
  entries,
  loading,
  canView,
}: {
  entries: LedgerEntryItem[];
  loading: boolean;
  canView: boolean;
}) {
  if (!canView) {
    return (
      <TabEmptyState
        title="Ledger unavailable"
        description="You do not have permission to view the ledger."
      />
    );
  }
  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (entries.length === 0) {
    return (
      <TabEmptyState
        title="No ledger entries"
        description="Debits and credits appear when invoices or payments are posted."
      />
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-surface">
          <tr className="border-b border-border text-left text-muted">
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border">
              <td className="px-3 py-2">{entry.entryDate}</td>
              <td className="px-3 py-2 text-muted">{entry.referenceType}</td>
              <td className="px-3 py-2">{entry.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {entry.debitCentavos !== "0"
                  ? formatCentavos(BigInt(entry.debitCentavos))
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {entry.creditCentavos !== "0"
                  ? formatCentavos(BigInt(entry.creditCentavos))
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCentavos(BigInt(entry.balanceCentavos))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceHistoryTab({
  accounts,
}: {
  accounts: Array<{ id: string; accountNumber: string }>;
}) {
  const { api } = useAuth();

  if (accounts.length === 0) {
    return (
      <TabEmptyState
        title="No service history"
        description="Service events appear when service accounts exist."
      />
    );
  }

  return (
    <div className="space-y-6">
      {accounts.map((account) => (
        <ServiceAccountEvents
          key={account.id}
          accountId={account.id}
          accountNumber={account.accountNumber}
          api={api}
        />
      ))}
    </div>
  );
}

function ServiceAccountEvents({
  accountId,
  accountNumber,
  api,
}: {
  accountId: string;
  accountNumber: string;
  api: ReturnType<typeof useAuth>["api"];
}) {
  const eventsQuery = useQuery({
    queryKey: ["service-events", accountId],
    queryFn: () => api.listServiceEvents(accountId),
  });

  return (
    <div>
      <h3 className="mb-2 font-mono text-sm font-medium text-ink">
        {accountNumber}
      </h3>
      {(eventsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">No events recorded.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {(eventsQuery.data ?? []).map((ev) => (
            <li key={ev.id} className="rounded border border-border px-3 py-2">
              <span className="text-muted">
                {new Date(ev.createdAt).toLocaleString()}
              </span>
              {" — "}
              {ev.oldStatus ?? "—"} → {ev.newStatus ?? "—"}
              {ev.reason ? ` (${ev.reason})` : ""}
              {ev.actorName ? ` · ${ev.actorName}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubscriberDocumentsTab({
  items,
  loading,
  canView,
  error,
  onPreviewProof,
}: {
  items: Array<{
    kind: "receipt" | "gcash_proof";
    id: string;
    label: string;
    status: string;
    amountCentavos: string | null;
    at: string;
    paymentId: string;
    voided: boolean;
    mimeType: string | null;
    verifierName: string | null;
    referenceNumber?: string | null;
    verifiedAt?: string | null;
  }>;
  loading: boolean;
  canView: boolean;
  error: string | null;
  onPreviewProof: (proofId: string) => void | Promise<void>;
}) {
  if (!canView) {
    return (
      <TabEmptyState
        title="Documents restricted"
        description="receivable.view is required to list receipts and proofs."
      />
    );
  }
  if (loading) return <p className="text-sm text-muted">Loading documents…</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (items.length === 0) {
    return (
      <TabEmptyState
        title="No documents"
        description="Receipts and GCash proofs for this subscriber will appear here."
      />
    );
  }

  return (
    <div className="overflow-auto border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="border-b border-border text-left text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Label</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Details</th>
            <th className="px-3 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.kind}-${item.id}`} className="border-b border-border">
              <td className="px-3 py-2">
                {item.kind === "receipt" ? "Receipt" : "GCash proof"}
              </td>
              <td className="px-3 py-2 font-mono">{item.label}</td>
              <td className="px-3 py-2">
                <StatusBadge status={item.status} />
                {item.voided ? (
                  <span className="ml-2 font-bold uppercase text-danger">
                    VOID
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(item.at).toLocaleString("en-PH")}
              </td>
              <td className="px-3 py-2 text-muted">
                {item.kind === "receipt" && item.amountCentavos
                  ? formatCentavos(BigInt(item.amountCentavos))
                  : null}
                {item.kind === "gcash_proof"
                  ? [
                      item.referenceNumber
                        ? `Ref ${item.referenceNumber}`
                        : null,
                      item.verifierName
                        ? `Verifier: ${item.verifierName}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null}
              </td>
              <td className="px-3 py-2">
                {item.kind === "receipt" ? (
                  <Link
                    className="text-burgundy hover:underline"
                    to={`/payments/receipts/${item.id}`}
                  >
                    Print
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="text-burgundy hover:underline"
                    onClick={() => void onPreviewProof(item.id)}
                  >
                    Preview
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriberAuditTab({
  items,
  loading,
  canView,
  error,
}: {
  items: Array<{
    id: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string | null;
    reason: string | null;
    at: string;
    oldSummary: string;
    newSummary: string;
  }>;
  loading: boolean;
  canView: boolean;
  error: string | null;
}) {
  if (!canView) {
    return (
      <TabEmptyState
        title="Audit restricted"
        description="audit.view is required to see this subscriber’s audit trail."
      />
    );
  }
  if (loading) return <p className="text-sm text-muted">Loading audit…</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (items.length === 0) {
    return (
      <TabEmptyState
        title="No audit entries"
        description="Changes to this subscriber, their accounts, invoices, and payments will appear here."
      />
    );
  }

  return (
    <div className="overflow-auto border border-border bg-surface">
      <table className="min-w-full text-sm">
        <thead className="border-b border-border text-left text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Actor</th>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Entity</th>
            <th className="px-3 py-2 font-medium">Reason</th>
            <th className="px-3 py-2 font-medium">Old → New</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(row.at).toLocaleString("en-PH")}
              </td>
              <td className="px-3 py-2">{row.actorName || "—"}</td>
              <td className="px-3 py-2">{row.action}</td>
              <td className="px-3 py-2">
                {row.entityType}
                {row.entityId ? (
                  <span className="text-muted">
                    {" "}
                    ({row.entityId.slice(0, 8)}…)
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">{row.reason ?? "—"}</td>
              <td className="px-3 py-2 text-muted">
                {row.oldSummary || row.newSummary
                  ? `${row.oldSummary || "—"} → ${row.newSummary || "—"}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
