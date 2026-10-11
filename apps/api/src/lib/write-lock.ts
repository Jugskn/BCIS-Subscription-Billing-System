/** In-process write lock used during backup restore. */
let writeLocked = false;
let lockReason = "";

export function isWriteLocked(): boolean {
  return writeLocked;
}

export function getWriteLockReason(): string {
  return lockReason || "System is restoring a backup. Try again shortly.";
}

export function acquireWriteLock(reason: string): void {
  writeLocked = true;
  lockReason = reason;
}

export function releaseWriteLock(): void {
  writeLocked = false;
  lockReason = "";
}
