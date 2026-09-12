export const BULK_SITE_IMPORT_SLOW_CLEANUP_INTERVAL_MS = 60_000;

// Run once at startup, then even when no imports arrive. Multiple API instances
// may safely delete expired rows; do not let a slow run accumulate timer jobs.
export function startBulkSiteImportSlowWindowCleanup(options: {
  cleanup: () => Promise<void>;
  onError: (error: unknown) => void;
  intervalMs?: number;
}): () => void {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await options.cleanup();
    } catch (error) {
      options.onError(error);
    } finally {
      running = false;
    }
  }
  void tick();
  const timer = setInterval(
    () => void tick(),
    options.intervalMs ?? BULK_SITE_IMPORT_SLOW_CLEANUP_INTERVAL_MS,
  );
  timer.unref();
  return () => clearInterval(timer);
}