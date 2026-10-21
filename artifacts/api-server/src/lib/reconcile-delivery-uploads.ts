export interface DeliveryUploadObject {
  objectPath: string;
  createdAt: Date | null;
  size?: number;
}

export interface ReconciliationFailure {
  objectPath: string;
  error: string;
}

export interface ReconciliationSummary {
  scanned: number;
  referenced: number;
  tooYoung: number;
  unknownAge: number;
  candidates: number;
  preserved: number;
  deleted: number;
  raceSkipped: number;
  failed: number;
  failures: ReconciliationFailure[];
}

export type ReconciliationEvent =
  | { type: "candidate"; object: DeliveryUploadObject }
  | { type: "preserved"; object: DeliveryUploadObject };

export interface ReconciliationDependencies {
  listUploads: () => Promise<DeliveryUploadObject[]>;
  listReferencedObjectPaths: () => Promise<Iterable<string>>;
  onEvent?: (event: ReconciliationEvent) => void;
}

export interface ReconciliationOptions {
  minimumAgeHours?: number;
  now?: Date;
}

export function validateMinimumAgeHours(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error("minimumAgeHours must be a finite integer greater than or equal to 1");
  }
  return value;
}

export async function reconcileDeliveryUploads(
  dependencies: ReconciliationDependencies,
  options: ReconciliationOptions = {},
): Promise<ReconciliationSummary> {
  const minimumAgeHours = validateMinimumAgeHours(options.minimumAgeHours ?? 24);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("now must be a valid date");
  }
  const cutoff = now.getTime() - minimumAgeHours * 60 * 60 * 1000;
  const uploads = await dependencies.listUploads();
  const referencedPaths = new Set(await dependencies.listReferencedObjectPaths());
  const summary: ReconciliationSummary = {
    scanned: 0,
    referenced: 0,
    tooYoung: 0,
    unknownAge: 0,
    candidates: 0,
    preserved: 0,
    deleted: 0,
    raceSkipped: 0,
    failed: 0,
    failures: [],
  };

  for (const object of uploads) {
    summary.scanned += 1;
    if (referencedPaths.has(object.objectPath)) {
      summary.referenced += 1;
      continue;
    }
    const createdAtMs = object.createdAt?.getTime();
    if (createdAtMs === undefined || !Number.isFinite(createdAtMs)) {
      summary.unknownAge += 1;
      continue;
    }
    if (createdAtMs >= cutoff) {
      summary.tooYoung += 1;
      continue;
    }

    summary.candidates += 1;
    dependencies.onEvent?.({ type: "candidate", object });
    // A storage prefix can be shared by deployments backed by separate
    // databases. Absence from this database is therefore not proof that the
    // object is unowned. Orphan reconciliation is deliberately report-only.
    summary.preserved += 1;
    dependencies.onEvent?.({ type: "preserved", object });
  }

  return summary;
}