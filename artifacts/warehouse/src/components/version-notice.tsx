import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

declare const __APP_BUILD_ID__: string | null;

const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLL_INTERVAL_MS = 60_000;

export function startVersionChecks({
  buildId,
  baseUrl,
  onUpdate,
  intervalMs = POLL_INTERVAL_MS,
}: {
  buildId: string;
  baseUrl: string;
  onUpdate: () => void;
  intervalMs?: number;
}): () => void {
  if (!BUILD_ID_PATTERN.test(buildId)) return () => {};

  let stopped = false;
  let updated = false;
  let active: AbortController | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  async function check() {
    if (stopped || updated || document.hidden || active) return;
    const controller = new AbortController();
    active = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const url = new URL(`${baseUrl}version.json`, window.location.origin);
      url.searchParams.set("t", String(Date.now()));
      const response = await fetch(url.href, {
        cache: "no-store",
        signal: controller.signal,
        credentials: "same-origin",
      });
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) return;
      const data: unknown = await response.json();
      if (stopped || updated || document.hidden || controller.signal.aborted) return;
      if (
        typeof data === "object" &&
        data !== null &&
        "buildId" in data &&
        typeof data.buildId === "string" &&
        BUILD_ID_PATTERN.test(data.buildId) &&
        data.buildId !== buildId
      ) {
        updated = true;
        pause();
        onUpdate();
      }
    } catch {
      // Offline, an interrupted request or an invalid response isn't a new build.
    } finally {
      clearTimeout(timeout);
      if (active === controller) active = undefined;
    }
  }

  function pause() {
    if (interval) clearInterval(interval);
    interval = undefined;
    active?.abort();
    active = undefined;
  }

  function resume() {
    if (stopped || updated || document.hidden) return;
    if (!interval) interval = setInterval(check, intervalMs);
    void check();
  }

  function visibilityChanged() {
    if (document.hidden) pause();
    else resume();
  }

  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("focus", resume);
  resume();
  return () => {
    stopped = true;
    pause();
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("focus", resume);
  };
}

export function VersionUpdateBanner() {
  return (
    <div
      role="status"
      data-testid="banner-version-update"
      className="sticky top-0 z-[60] flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-sm md:px-6"
    >
      <div>
        <strong className="block" data-testid="text-version-update">Доступна новая версия</strong>
        <span>Сохраните изменения перед обновлением страницы: несохранённые данные могут быть потеряны.</span>
      </div>
      <Button
        type="button"
        variant="outline"
        data-testid="button-reload-version"
        onClick={() => window.location.reload()}
      >
        <RefreshCw aria-hidden="true" />
        Обновить страницу
      </Button>
    </div>
  );
}

export function VersionNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !__APP_BUILD_ID__) return;
    return startVersionChecks({
      buildId: __APP_BUILD_ID__,
      baseUrl: import.meta.env.BASE_URL,
      onUpdate: () => setUpdateAvailable(true),
    });
  }, []);

  return updateAvailable ? <VersionUpdateBanner /> : null;
}