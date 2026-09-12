import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadFileResponse, resolveAppUrl } from "@/lib/download-file";

describe("download-file", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses HEAD preflight and a native streaming download link", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => {},
    );
    await downloadFileResponse("/api/deliveries/acts/download", "acts.zip");
    expect(fetchMock).toHaveBeenCalledWith("/api/deliveries/acts/download", {
      method: "HEAD",
      credentials: "same-origin",
    });
    expect(click).toHaveBeenCalledOnce();
  });

  it("decodes the structured HEAD error without reading a response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 404,
        headers: { "X-Download-Error": encodeURIComponent("Актов нет") },
      }),
    );
    await expect(
      downloadFileResponse("/api/deliveries/acts/download", "acts.zip"),
    ).rejects.toThrow("Актов нет");
  });

  it("keeps API paths under the Vite application base", () => {
    expect(resolveAppUrl("/api/storage/objects/file")).toBe(
      "/api/storage/objects/file",
    );
  });
});