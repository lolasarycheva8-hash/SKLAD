import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";

// Constructed once per Vite build: the embedded ID and emitted metadata cannot drift.
export function createBuildVersion(): { buildId: string; plugin: Plugin } {
  const buildId = randomUUID();
  return {
    buildId,
    plugin: {
      name: "warehouse-build-version",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ buildId }),
        });
      },
    },
  };
}