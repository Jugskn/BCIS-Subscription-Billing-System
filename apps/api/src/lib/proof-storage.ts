import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { AppError } from "./errors.js";

export const ALLOWED_PROOF_MIME = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

export function assertProofMime(mimeType: string): void {
  if (!ALLOWED_PROOF_MIME.has(mimeType)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Proof must be a JPG, PNG, or PDF file.",
    );
  }
}

export function assertProofSize(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes <= 0 || sizeBytes > maxBytes) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Proof file must be between 1 byte and ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
  }
}

/** Safe generated filename: uuid + hash prefix + allowed extension only. */
export function buildSafeProofFilename(mimeType: string, content: Buffer): string {
  assertProofMime(mimeType);
  const ext = MIME_EXT[mimeType] ?? ".bin";
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `${randomUUID()}-${hash}${ext}`;
}

export async function storeProofFile(options: {
  uploadDir: string;
  mimeType: string;
  content: Buffer;
  originalFilename: string;
}): Promise<{
  storedFilename: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}> {
  assertProofMime(options.mimeType);
  const storedFilename = buildSafeProofFilename(options.mimeType, options.content);
  const base = resolve(options.uploadDir);
  await mkdir(base, { recursive: true });
  const storagePath = join(base, storedFilename);
  await writeFile(storagePath, options.content);

  const original = options.originalFilename
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .slice(0, 180);
  const safeOriginal =
    original.length > 0
      ? original
      : `proof${extname(storedFilename) || ".bin"}`;

  return {
    storedFilename,
    storagePath,
    originalFilename: safeOriginal,
    mimeType: options.mimeType,
    sizeBytes: options.content.length,
  };
}
