import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { bounded } from "./runtime";

export function publicAddress(address: string) {
  if (address.includes(":")) return /^[23][0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith("2001:db8:");
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
}
export async function notifyFailure(operation: string, value?: string) {
  if (!value) { console.error("Backup alert webhook NOT CONFIGURED; independent monitoring must observe the exit status."); return; }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("Alert webhook must be HTTPS");
  const addresses = await bounded(lookup(url.hostname, { all: true }), 10_000);
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error("Webhook must resolve exclusively to public addresses");
  const selected = addresses[0];
  await new Promise<void>((resolve, reject) => {
    // Pin the validated DNS result. TLS still authenticates the original hostname. No redirects.
    const req = request(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      family: selected.family,
      signal: AbortSignal.timeout(10_000),
      lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
    }, response => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(new Error("Webhook failed"));
    });
    req.once("error", () => reject(new Error("Webhook failed")));
    req.end(JSON.stringify({ service: "warehouse-backup", command: operation, status: "FAILED", action: "Check backup monitor and authenticated manifests" }));
  });
}