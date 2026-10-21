import { describe, expect, it } from "vitest";
import { createBuildVersion } from "../../scripts/build-version";

describe("build metadata", () => {
  it("emits the same valid ID that is embedded in the bundle", () => {
    const { buildId, plugin } = createBuildVersion();
    const assets: Array<{ type: string; fileName: string; source: string }> = [];
    const hook = plugin.generateBundle;
    expect(typeof hook).toBe("function");
    if (typeof hook !== "function") throw new Error("Missing bundle hook");
    hook.call(
      { emitFile: (asset: { type: string; fileName: string; source: string }) => assets.push(asset) } as never,
      {} as never,
      {} as never,
      false,
    );
    expect(buildId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(assets).toEqual([{ type: "asset", fileName: "version.json", source: JSON.stringify({ buildId }) }]);
    expect(createBuildVersion().buildId).not.toBe(buildId);
  });
});