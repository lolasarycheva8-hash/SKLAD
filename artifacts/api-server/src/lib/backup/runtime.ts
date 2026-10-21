export const shutdown = new AbortController();
export class BackupFailure extends Error {}
export function operationSignal(milliseconds = 120_000) {
  return AbortSignal.any([shutdown.signal, AbortSignal.timeout(milliseconds)]);
}
export function deadlineMinutes(value = process.env.BACKUP_DEADLINE_MINUTES || "30") {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 90) throw new Error("BACKUP_DEADLINE_MINUTES must be 1..90");
  return minutes;
}
export function throwIfStopped() { shutdown.signal.throwIfAborted(); }
export async function bounded<T>(operation: Promise<T>, milliseconds = 30_000): Promise<T> {
  const signal = operationSignal(milliseconds);
  signal.throwIfAborted();
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new BackupFailure("Backup operation timed out or was cancelled"));
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener("abort", rejectAbort); }
}