import {
  validateMinimumAgeHours,
} from "../lib/reconcile-delivery-uploads";
import {
  createProductionDeliveryUploadCleanupDependencies,
  runDeliveryUploadCleanup,
} from "../lib/delivery-upload-cleanup";

interface CliOptions {
  dryRun: boolean;
  minimumAgeHours: number;
  help: boolean;
}

function usage(): string {
  return [
    "Usage: pnpm run cleanup:delivery-uploads [--dry-run|--delete] [--min-age-hours=N]",
    "",
    "  --dry-run          List candidates without deleting (default)",
    "  --delete           Delete candidates after an exact DB reference re-check",
    "  --min-age-hours=N  Minimum object age, integer >= 1 (default: 24)",
    "  --help             Show this help",
  ].join("\n");
}

export function parseCliOptions(args: string[]): CliOptions {
  let dryRun = true;
  let minimumAgeHours = 24;
  let help = false;
  for (const arg of args) {
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--delete") dryRun = false;
    else if (arg === "--help") help = true;
    else if (arg.startsWith("--min-age-hours=")) {
      const raw = arg.slice("--min-age-hours=".length);
      if (!/^\d+$/.test(raw)) throw new Error("--min-age-hours must be a finite integer >= 1");
      minimumAgeHours = validateMinimumAgeHours(Number(raw));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun, minimumAgeHours, help };
}

function writeJson(
  destination: NodeJS.WriteStream,
  event: Record<string, unknown>,
): void {
  destination.write(`${JSON.stringify(event)}\n`);
}

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch (error) {
    writeJson(process.stderr, {
      event: "fatal",
      error: error instanceof Error ? error.message : String(error),
    });
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  let pool: { end: () => Promise<void> } | undefined;
  let exitCode = 1;
  try {
    const { db, deliveriesTable, deliveryPhotosTable, pool: dbPool } =
      await import("@workspace/db");
    pool = dbPool;
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const objectStorage = new ObjectStorageService();
    writeJson(process.stdout, {
      event: "start",
      dryRun: options.dryRun,
      minimumAgeHours: options.minimumAgeHours,
    });

    const summary = await runDeliveryUploadCleanup(
      createProductionDeliveryUploadCleanupDependencies(
        db,
        deliveriesTable,
        deliveryPhotosTable,
        objectStorage,
        {
          info: (_bindings, _message) => {},
          debug: (bindings, _message) => writeJson(process.stdout, bindings),
          error: (bindings, _message) => writeJson(process.stderr, bindings),
        },
      ),
      { dryRun: options.dryRun, minimumAgeHours: options.minimumAgeHours },
    );
    if (summary === null) {
      writeJson(process.stdout, { event: "skipped" });
      exitCode = 0;
    } else {
      writeJson(process.stdout, { event: "summary", ...summary });
      exitCode = summary.failed > 0 ? 1 : 0;
    }
  } catch (error) {
    writeJson(process.stderr, {
      event: "fatal",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        writeJson(process.stderr, {
          event: "fatal",
          operation: "closeDbPool",
          error: error instanceof Error ? error.message : String(error),
        });
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});