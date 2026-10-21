import { config } from "../lib/backup/config";
import { BackupStore } from "../lib/backup/store";
import { create, health, verifyRestore } from "../lib/backup/operations";
import { notifyFailure } from "../lib/backup/notify";
import { BackupFailure, deadlineMinutes, shutdown } from "../lib/backup/runtime";
async function main() {
  const operation = process.argv[2];
  if (!["create", "schedule", "health", "verify-restore"].includes(operation) || process.argv.length !== 3) throw new Error("Usage: backup <create|schedule|health|verify-restore>");
  const store = new BackupStore(config());
  if (!process.env.BACKUP_ALERT_WEBHOOK_URL) console.error("Backup alert webhook NOT CONFIGURED; this command does not activate monitoring.");
  try {
    const result = operation === "create" ? await create(store)
      : operation === "schedule" ? await create(store, true)
      : operation === "health" ? await health(store)
      : await verifyRestore(store);
    console.log(JSON.stringify({ command: operation, ...result }));
  } finally { store.client.destroy(); }
}
let hardStop: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (shutdown.signal.aborted) return;
  console.error("Backup deadline/signal reached; aborting work. No new successful marker is authorized.");
  shutdown.abort();
  process.exitCode = 1;
  hardStop = setTimeout(() => process.exit(1), 30_000);
  hardStop.unref();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
let deadline: ReturnType<typeof setTimeout> | undefined;
// No raw driver/tool/SDK errors: these may contain credentials, SQL or object paths.
Promise.resolve().then(() => {
  deadline = setTimeout(stop, deadlineMinutes() * 60_000);
  return main();
}).catch(async (error: unknown) => {
  console.error(error instanceof BackupFailure ? error.message : "Backup command failed. Check configuration, connectivity, tool versions and authenticated manifests. No successful backup/drill is claimed.");
  process.exitCode = 1;
  try { await notifyFailure(["create", "schedule", "health", "verify-restore"].includes(process.argv[2]) ? process.argv[2] : "invalid", process.env.BACKUP_ALERT_WEBHOOK_URL); }
  catch { console.error("Backup alert delivery failed; independent monitoring must alert on this nonzero exit."); }
}).finally(() => {
  if (deadline) clearTimeout(deadline);
  if (hardStop && !shutdown.signal.aborted) clearTimeout(hardStop);
});