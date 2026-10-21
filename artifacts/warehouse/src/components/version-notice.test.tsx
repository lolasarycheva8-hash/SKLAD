import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VersionNotice, VersionUpdateBanner, startVersionChecks } from "./version-notice";

const CURRENT = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

describe("published version checks", () => {
  let hidden = false;
  let onUpdate: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    onUpdate = vi.fn();
    stop = () => {};
  });

  afterEach(() => {
    stop();
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const start = () => {
    stop = startVersionChecks({
      buildId: CURRENT,
      baseUrl: "/warehouse/",
      onUpdate,
    });
  };

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("checks matching builds without prompting and uses an uncached base-aware URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ buildId: CURRENT }));
    start();
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost:3000\/warehouse\/version\.json\?t=\d+$/),
      expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a different valid build once and leaves the banner visible", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ buildId: NEW }));
    start();
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    render(<VersionNotice />);
    // Development/HMR never polls or shows a misleading update.
    expect(screen.queryByTestId("banner-version-update")).toBeNull();
  });

  it("shows a persistent manual refresh with a warning to save edits first", () => {
    render(<VersionUpdateBanner />);
    expect(screen.getByTestId("banner-version-update").textContent).toContain("Доступна новая версия");
    expect(screen.getByTestId("banner-version-update").textContent).toContain("Сохраните изменения");
    expect(screen.getByTestId("button-reload-version").textContent).toContain("Обновить страницу");
  });

  it("ignores unavailable, malformed and non-JSON responses; retries on focus", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("<html>index</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(json({ buildId: "not-a-build" }))
      .mockResolvedValueOnce(new Response("broken", { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("failure", { status: 503 }))
      .mockResolvedValueOnce(json({ buildId: NEW }));
    start();
    await flush();
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event("focus"));
      await flush();
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("aborts while hidden and on teardown, then checks on return", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(json({ buildId: NEW }));
    start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discards a stale response even if transport ignores abort", async () => {
    let resolveResponse!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveResponse = resolve; }),
    );
    start();
    stop();
    resolveResponse(json({ buildId: NEW }));
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});