import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputDir = "/tmp/warehouse-my-deliveries-browser-test";

await execFileAsync(
  "pnpm",
  ["exec", "vite", "build", "--config", "vite.browser-test.config.ts"],
  { cwd: path.resolve(import.meta.dirname, "..") },
);

const server = http.createServer(async (req, res) => {
  const requested = req.url === "/" ? "index.html" : req.url?.replace(/^\//, "");
  const filePath = path.join(outputDir, requested || "index.html");
  let contents;
  try {
    contents = await readFile(filePath);
  } catch {
    res.writeHead(404).end();
    return;
  }
  const extension = path.extname(filePath);
  const contentType = extension === ".html"
    ? "text/html"
    : extension === ".js"
      ? "text/javascript"
      : extension === ".css"
        ? "text/css"
        : "application/octet-stream";
  res.setHeader("content-type", contentType);
  res.end(contents);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");

const debugPort = 12000 + Math.floor(Math.random() * 2000);
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "warehouse-chromium-"));
const chromium = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=390,844",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chromium DevTools endpoint did not start");
}

try {
  const pages = await waitForDebugger();
  const page = pages.find(
    (candidate) =>
      candidate.type === "page" &&
      !candidate.url.startsWith("chrome-extension://"),
  );
  assert(page?.webSocketDebuggerUrl);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let requestId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  function command(method, params = {}) {
    const id = ++requestId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Page.navigate", {
    url: `http://127.0.0.1:${address.port}/`,
  });

  let result;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    result = await command("Runtime.evaluate", {
      returnByValue: true,
      awaitPromise: true,
      expression: `(async () => {
        const card = document.querySelector('[data-testid="delivery-card-browser-own-delivery"]');
        if (!card) return null;
        const name = document.querySelector('[data-testid="delivery-site-name-browser-own-delivery"]');
        const note = document.querySelector('[data-testid="delivery-note-browser-own-delivery"]');
        const done = document.querySelector('[data-testid="button-mark-done-browser-own-delivery"]');
        const acts = document.querySelector('[data-testid="button-acts-browser-own-delivery"]');
        const inside = (child, parent) => {
          const childRect = child.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          return childRect.left >= parentRect.left && childRect.right <= parentRect.right;
        };
        acts.scrollIntoView({ block: 'center' });
        acts.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const actsRect = acts.getBoundingClientRect();
        return {
          innerWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          nameInsideCard: inside(name, card),
          noteInsideCard: inside(note, card),
          doneEnabled: !done.disabled,
          actsEnabled: !acts.disabled,
          actsVisible: actsRect.width > 0 && actsRect.left >= 0 && actsRect.right <= innerWidth,
          dialogOpened: !!document.querySelector('[data-testid="acts-dialog"]'),
          foreignDeliveryVisible: document.body.textContent.includes('Чужой-объект'),
          overflowElements: [...document.querySelectorAll('*')]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.right > document.documentElement.clientWidth || rect.left < 0;
            })
            .slice(0, 10)
            .map((element) => ({
              tag: element.tagName,
              className: String(element.className).slice(0, 160),
              testId: element.getAttribute('data-testid'),
              rect: element.getBoundingClientRect().toJSON(),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            })),
        };
      })()`,
    });
    if (result.result.value) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const metrics = result?.result?.value;
  if (!metrics) {
    const debug = await command("Runtime.evaluate", {
      returnByValue: true,
      expression: `({
        location: location.href,
        readyState: document.readyState,
        body: document.body.innerText,
        html: document.body.innerHTML.slice(0, 1000)
      })`,
    });
    assert(metrics, `Delivery card did not render: ${JSON.stringify(debug.result.value)}`);
  }
  assert.equal(metrics.innerWidth, 390);
  assert(metrics.scrollWidth <= metrics.clientWidth, JSON.stringify(metrics));
  assert.equal(metrics.nameInsideCard, true);
  assert.equal(metrics.noteInsideCard, true);
  assert.equal(metrics.doneEnabled, true);
  assert.equal(metrics.actsEnabled, true);
  assert.equal(metrics.actsVisible, true);
  assert.equal(metrics.dialogOpened, true);
  assert.equal(metrics.foreignDeliveryVisible, false);
  console.log("Mobile browser metrics:", metrics);
  socket.close();
} finally {
  chromium.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}