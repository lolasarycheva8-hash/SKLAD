export function resolveAppUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}

export async function downloadFileResponse(
  path: string,
  fallbackFileName: string,
): Promise<void> {
  const url = resolveAppUrl(path);
  const response = await fetch(url, {
    method: "HEAD",
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = `Ошибка выгрузки (${response.status})`;
    try {
      const encoded = response.headers.get("X-Download-Error");
      if (encoded) message = decodeURIComponent(encoded);
      else {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error) message = body.error;
      }
    } catch {
      // The status-based message remains actionable when the server did not return JSON.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}