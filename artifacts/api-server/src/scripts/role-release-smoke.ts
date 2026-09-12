import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createClerkClient } from "@clerk/express";
import {
  BACKFILL_LEGACY_REVIEW_AUTHOR_NAMES_SQL,
  pool,
  type AppUser,
} from "@workspace/db";

import {
  DELIVERY_UPLOAD_CLEANUP_LOCK_NAME,
  DELIVERY_UPLOAD_CLEANUP_STATUS_LOCK_NAME,
  DELIVERY_UPLOAD_LOCK_NAMESPACE,
  DELIVERY_UPLOAD_LOCK_SEED,
} from "../lib/delivery-upload-lock";
import { legacyDriverSimilarityKey } from "../lib/legacy-driver-similarity";

type SmokeRole = "viewer" | "editor" | "admin" | "driver";

type SmokeUser = {
  clerkUserId?: string;
  appUserId?: string;
  email: string;
  role: SmokeRole;
};

type CreatedSmokeUser = {
  clerkUserId: string;
  appUserId: string;
  name: string;
};

type LegacyMappingFixture = {
  legacyName: string;
  similarLegacyNames: [string, string];
  similarityGroup: string;
  siteIds: string[];
};

type LegacyReviewMetadataFixture = {
  reviewedGroup: string;
  legacyReviewedGroup: string;
  deletedAuthorGroup: string;
  unnamedAuthorGroup: string;
  unnamedAuthorId: string;
  unreviewedGroup: string;
  reviewerName: string;
  siteIds: string[];
};

type DriverAccessFixture = {
  siteId: string;
  roleDriverDeliveryId: string;
  legacyDriverDeliveryId: string;
};

type DevToolsPage = {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type DatabaseClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: (destroy?: boolean | Error) => void;
};

type CleanupStatusSnapshot = {
  lastRunAt: Date;
  lastSuccessfulRunAt: Date | null;
  status: string;
  failureKind: "none" | "list_timeout" | "other";
  consecutiveFailures: number;
  scanned: number;
  candidates: number;
  deleted: number;
  resumedPhotoDeletions: number;
  resumedDeliveryDeletions: number;
  failed: number;
  updatedAt: Date;
};

const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) {
  throw new Error(
    "CLERK_SECRET_KEY is required for the role release smoke test",
  );
}
if (!secretKey.startsWith("sk_test_")) {
  throw new Error(
    "The role release smoke test may only run against the Clerk development instance",
  );
}
if (process.env.ROLE_SMOKE_ALLOW_DEVELOPMENT_MUTATIONS !== "1") {
  throw new Error(
    "Set ROLE_SMOKE_ALLOW_DEVELOPMENT_MUTATIONS=1 to confirm temporary development-only user creation",
  );
}

const developmentDomain = process.env.REPLIT_DEV_DOMAIN;
if (!developmentDomain) {
  throw new Error(
    "REPLIT_DEV_DOMAIN is required to identify the development app",
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the role smoke test");
}

const configuredBaseUrl =
  process.env.ROLE_SMOKE_BASE_URL ?? `https://${developmentDomain}`;
const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
if (new URL(baseUrl).hostname !== developmentDomain) {
  throw new Error(
    "ROLE_SMOKE_BASE_URL must point to the current Replit development domain",
  );
}
const clerk = createClerkClient({ secretKey });
const createdUsers: SmokeUser[] = [];
const inFlightClerkCreations = new Map<string, Promise<string>>();
let cancellationSignal: NodeJS.Signals | undefined;
let browserStartupCleanup: (() => Promise<void>) | undefined;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfCancelled() {
  if (cancellationSignal) {
    throw new Error(`Role smoke cancelled by ${cancellationSignal}`);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out: ${description}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopChromium(
  chromium: ReturnType<typeof spawn>,
  userDataDir: string,
) {
  if (chromium.exitCode === null) {
    chromium.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise<true>((resolve) =>
        chromium.once("exit", () => resolve(true)),
      ),
      delay(2_000).then(() => false),
    ]);
    if (!exited && chromium.exitCode === null) {
      chromium.kill("SIGKILL");
      await Promise.race([
        new Promise<void>((resolve) => chromium.once("exit", () => resolve())),
        delay(2_000),
      ]);
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOTEMPTY"
        ) ||
        attempt === 9
      ) {
        throw error;
      }
      await delay(100);
    }
  }
}

async function waitForApp() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The workflow may still be restarting.
    }
    await delay(200);
  }
  throw new Error(`Application did not become ready at ${baseUrl}`);
}

class BrowserSession {
  private readonly socket: WebSocket;
  private requestId = 0;
  private closing?: Promise<void>;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }
  >();

  private constructor(
    socket: WebSocket,
    private readonly cleanupProcess: () => Promise<void>,
  ) {
    this.socket = socket;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result);
      }
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  static async launch() {
    throwIfCancelled();
    const debugPort = await getFreePort();
    const userDataDir = await mkdtemp(
      path.join(os.tmpdir(), "warehouse-role-smoke-"),
    );
    const chromium = spawn(
      "chromium",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--ignore-certificate-errors",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        "--window-size=1280,900",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    let cleanupPromise: Promise<void> | undefined;
    const cleanupProcess = () => {
      cleanupPromise ??= stopChromium(chromium, userDataDir);
      return cleanupPromise;
    };
    browserStartupCleanup = cleanupProcess;
    let socket: WebSocket | undefined;
    let succeeded = false;

    try {
      let pages: DevToolsPage[] | undefined;
      for (let attempt = 0; attempt < 300; attempt += 1) {
        throwIfCancelled();
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json`, {
            signal: AbortSignal.timeout(1_000),
          });
          if (response.ok) {
            pages = (await response.json()) as DevToolsPage[];
            break;
          }
        } catch {
          // Chromium is still starting.
        }
        await delay(100);
      }

      const page = pages?.find(
        (candidate) =>
          candidate.type === "page" &&
          !candidate.url.startsWith("chrome-extension://"),
      );
      if (!page?.webSocketDebuggerUrl) {
        throw new Error("Chromium DevTools endpoint did not start");
      }

      socket = new WebSocket(page.webSocketDebuggerUrl);
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket?.addEventListener("open", () => resolve(), { once: true });
          socket?.addEventListener(
            "error",
            () => reject(new Error("CDP socket failed")),
            { once: true },
          );
        }),
        10_000,
        "open Chromium DevTools socket",
      );
      throwIfCancelled();
      const browser = new BrowserSession(socket, cleanupProcess);
      try {
        await browser.command("Page.enable");
        await browser.command("Runtime.enable");
      } catch (error) {
        await browser.close();
        throw error;
      }
      succeeded = true;
      return browser;
    } finally {
      if (!succeeded) {
        socket?.close();
        await cleanupProcess();
        if (browserStartupCleanup === cleanupProcess) {
          browserStartupCleanup = undefined;
        }
      }
    }
  }

  private command(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ) {
    const id = ++this.requestId;
    this.socket.send(JSON.stringify({ id, method, params }));
    const response = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    return withTimeout(response, timeoutMs, `CDP command ${method}`).finally(
      () => {
        this.pending.delete(id);
      },
    );
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.command(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      30_000,
    );
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "Browser evaluation failed",
      );
    }
    return response.result.value as T;
  }

  async navigate(target: string) {
    await this.command("Page.navigate", { url: target });
    await this.waitUntil(
      "document.readyState === 'complete'",
      `page load for ${new URL(target).pathname}`,
    );
  }

  async waitUntil(expression: string, description: string) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) return;
      await delay(100);
    }
    const state = await this.evaluate(
      "({ href: location.href, body: document.body.innerText.slice(0, 500) })",
    );
    throw new Error(
      `Timed out waiting for ${description}: ${JSON.stringify(state)}`,
    );
  }

  async signIn(userId: string) {
    const signInToken = await withTimeout(
      clerk.signInTokens.createSignInToken({
        userId,
        expiresInSeconds: 60,
      }),
      15_000,
      "create Clerk sign-in token",
    );
    await this.navigate(`${baseUrl}/sign-in`);
    await this.waitUntil(
      "window.Clerk?.loaded && window.Clerk?.client?.signIn && window.Clerk?.setActive",
      "ClerkJS",
    );

    const result = await this.evaluate<{
      ok: boolean;
      status?: string;
      error?: string;
    }>(`(async () => {
      try {
        const attempt = await window.Clerk.client.signIn.create({
          strategy: "ticket",
          ticket: ${JSON.stringify(signInToken.token)}
        });
        if (attempt.status !== "complete" || !attempt.createdSessionId) {
          return { ok: false, status: attempt.status };
        }
        await window.Clerk.setActive({ session: attempt.createdSessionId });
        return { ok: true, status: attempt.status };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    })()`);
    assert.equal(
      result.ok,
      true,
      `Clerk ticket sign-in failed (${result.status ?? result.error ?? "unknown"})`,
    );
    await this.waitUntil(
      `(async () => (await fetch("/api/users/me")).status === 200)()`,
      "authenticated application session",
    );
  }

  async apiStatus(
    endpoint: string,
    options: { method?: string; body?: unknown } = {},
  ) {
    return this.evaluate<number>(`(async () => {
      const response = await fetch(${JSON.stringify(endpoint)}, {
        method: ${JSON.stringify(options.method ?? "GET")},
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: ${
          options.body === undefined
            ? "undefined"
            : JSON.stringify(JSON.stringify(options.body))
        }
      });
      return response.status;
    })()`);
  }

  async apiJson<T>(endpoint: string) {
    return this.evaluate<{ status: number; body: T }>(`(async () => {
      const response = await fetch(${JSON.stringify(endpoint)}, {
        credentials: "include",
        headers: { "content-type": "application/json" }
      });
      return { status: response.status, body: await response.json() };
    })()`);
  }

  async click(testId: string) {
    await this.waitUntil(
      `document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']')`,
      `${testId} to render`,
    );
    await this.evaluate(`(() => {
      const element = document.querySelector(
        '[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']'
      );
      if (!(element instanceof HTMLElement)) {
        throw new Error(${JSON.stringify(`Element ${testId} is not clickable`)});
      }
      element.click();
    })()`);
  }

  async text(testId: string) {
    return this.evaluate<string>(`(() => {
      const element = document.querySelector(
        '[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']'
      );
      return element?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
    })()`);
  }

  async close() {
    this.closing ??= this.performClose();
    return this.closing;
  }

  private async performClose() {
    this.socket.close();
    await this.cleanupProcess();
  }
}

async function withBrowser<T>(run: (browser: BrowserSession) => Promise<T>) {
  throwIfCancelled();
  const browser = await BrowserSession.launch();
  activeBrowser = browser;
  browserStartupCleanup = undefined;
  try {
    throwIfCancelled();
    return await run(browser);
  } finally {
    if (activeBrowser === browser) activeBrowser = undefined;
    await browser.close();
  }
}

async function createSmokeUser(
  role: SmokeRole,
  editableSections: AppUser["editableSections"],
  options: { isDriver?: boolean } = {},
): Promise<CreatedSmokeUser> {
  throwIfCancelled();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `role-smoke-${role}-${runId}@example.com`;
  const name = `Role smoke ${role}`;
  const trackedUser: SmokeUser = { email, role };
  createdUsers.push(trackedUser);
  const creation = clerk.users
    .createUser({
      emailAddress: [email],
      firstName: "Role smoke",
      lastName: role,
      password: `RoleSmoke!${randomUUID()}aA1`,
    })
    .then((user) => {
      trackedUser.clerkUserId = user.id;
      return user.id;
    });
  inFlightClerkCreations.set(email, creation);
  void creation
    .catch(() => undefined)
    .finally(() => inFlightClerkCreations.delete(email));

  const clerkUserId = await withTimeout(
    creation,
    20_000,
    `create temporary Clerk ${role} user`,
  );
  throwIfCancelled();

  const insertion = (await withBoundedDatabaseClient(
    `insert temporary ${role} app user`,
    (client) =>
      client.query(
        `INSERT INTO app_users
          (clerk_user_id, email, name, role, editable_sections, is_driver)
         VALUES ($1, $2, $3, $4::user_role, $5::text[], $6)
         RETURNING id`,
        [
          clerkUserId,
          email,
          name,
          role,
          editableSections,
          options.isDriver ?? false,
        ],
      ),
  )) as { rows: Array<{ id: string }> };
  const appUserId = insertion.rows[0]?.id;
  assert(appUserId, "Temporary app user insert did not return an id");
  trackedUser.appUserId = appUserId;
  throwIfCancelled();
  return { clerkUserId, appUserId, name };
}

async function createDriverAccessFixture(
  roleDriver: CreatedSmokeUser,
  legacyDriver: CreatedSmokeUser,
): Promise<DriverAccessFixture> {
  return withBoundedDatabaseClient(
    "create driver access fixture",
    async (client) => {
      const clientResult = (await client.query(
        "SELECT id, name FROM clients ORDER BY id LIMIT 1",
      )) as { rows: Array<{ id: string; name: string }> };
      const clientId = clientResult.rows[0]?.id;
      const clientName = clientResult.rows[0]?.name;
      assert(clientId, "Driver access smoke requires an existing client");
      assert(clientName, "Driver access smoke requires a named client");

      const siteResult = (await client.query(
        `INSERT INTO sites
          (name, address, branch, client, client_id, manager, director, project)
         VALUES
          ($1, 'Smoke driver address', 'Smoke branch', $2, $3, 'Smoke manager', 'Smoke director', 'Smoke project')
         RETURNING id`,
        [`Smoke driver access site ${randomUUID()}`, clientName, clientId],
      )) as { rows: Array<{ id: string }> };
      const siteId = siteResult.rows[0]?.id;
      assert(siteId, "Driver access smoke site insert did not return an id");

      const deliveryResult = (await client.query(
        `INSERT INTO deliveries
          (site_id, driver_user_id, planned_date, schedule_month)
         VALUES
          ($1, $2, '2098-01-10', '2098-01'),
          ($1, $3, '2098-01-11', '2098-01')
         RETURNING id, driver_user_id AS "driverUserId"`,
        [siteId, roleDriver.appUserId, legacyDriver.appUserId],
      )) as { rows: Array<{ id: string; driverUserId: string }> };
      const roleDriverDeliveryId = deliveryResult.rows.find(
        (row) => row.driverUserId === roleDriver.appUserId,
      )?.id;
      const legacyDriverDeliveryId = deliveryResult.rows.find(
        (row) => row.driverUserId === legacyDriver.appUserId,
      )?.id;
      assert(roleDriverDeliveryId, "Role driver delivery was not created");
      assert(legacyDriverDeliveryId, "Legacy driver delivery was not created");

      return {
        siteId,
        roleDriverDeliveryId,
        legacyDriverDeliveryId,
      };
    },
  ) as Promise<DriverAccessFixture>;
}

async function cleanupDriverAccessFixture(
  fixture: DriverAccessFixture | undefined,
) {
  if (!fixture) return;
  await withBoundedDatabaseClient(
    "delete driver access fixture",
    async (client) => {
      await client.query("DELETE FROM sites WHERE id = $1", [fixture.siteId]);
      const remaining = (await client.query(
        `SELECT count(*)::int AS count
           FROM deliveries
          WHERE id = ANY($1::uuid[])`,
        [[fixture.roleDriverDeliveryId, fixture.legacyDriverDeliveryId]],
      )) as { rows: Array<{ count: number }> };
      assert.deepEqual(remaining.rows, [{ count: 0 }]);
    },
  );
}

async function assertDriverRouteAccess(
  user: CreatedSmokeUser,
  ownDeliveryId: string,
  foreignDeliveryId: string,
) {
  await withBrowser(async (browser) => {
    await browser.signIn(user.clerkUserId);
    const ownDeliveries = await browser.apiJson<Array<{ id: string }>>(
      "/api/my/deliveries",
    );
    assert.equal(ownDeliveries.status, 200);
    assert.equal(
      ownDeliveries.body.some((delivery) => delivery.id === ownDeliveryId),
      true,
    );
    assert.equal(
      ownDeliveries.body.some((delivery) => delivery.id === foreignDeliveryId),
      false,
    );
    assert.equal(
      await browser.apiStatus(`/api/deliveries/${ownDeliveryId}/photos`),
      200,
    );
    assert.equal(
      await browser.apiStatus(`/api/deliveries/${foreignDeliveryId}/photos`),
      403,
    );
  });
}

async function createLegacyMappingFixture(): Promise<LegacyMappingFixture> {
  const legacyName = `Smoke legacy ${randomUUID()}`;
  const duplicateSuffix = randomUUID();
  const similarLegacyNames: [string, string] = [
    `Smoke duplicate-${duplicateSuffix}`,
    `Smoke duplicate ${duplicateSuffix}`,
  ];
  const result = (await withBoundedDatabaseClient(
    "create legacy driver mapping fixture",
    async (client) => {
      const clientResult = (await client.query(
        "SELECT id, name FROM clients ORDER BY id LIMIT 1",
      )) as { rows: Array<{ id: string; name: string }> };
      const clientId = clientResult.rows[0]?.id;
      const clientName = clientResult.rows[0]?.name;
      assert(clientId, "Legacy mapping smoke requires an existing client");
      assert(clientName, "Legacy mapping smoke requires a named client");
      const sites = (await client.query(
        `INSERT INTO sites
          (name, address, branch, client, client_id, manager, director, project, driver)
         VALUES
          ($1, 'Smoke address 1', 'Smoke branch', $9, $8, 'Smoke manager', 'Smoke director', 'Smoke project', $5),
          ($2, 'Smoke address 2', 'Smoke branch', $9, $8, 'Smoke manager', 'Smoke director', 'Smoke project', $5),
          ($3, 'Smoke duplicate address 1', 'Smoke branch', $9, $8, 'Smoke manager', 'Smoke director', 'Smoke project', $6),
          ($4, 'Smoke duplicate address 2', 'Smoke branch', $9, $8, 'Smoke manager', 'Smoke director', 'Smoke project', $7)
         RETURNING id`,
        [
          `Smoke legacy site ${randomUUID()}`,
          `Smoke legacy site ${randomUUID()}`,
          `Smoke duplicate site ${randomUUID()}`,
          `Smoke duplicate site ${randomUUID()}`,
          legacyName,
          ...similarLegacyNames,
          clientId,
          clientName,
        ],
      )) as { rows: Array<{ id: string }> };
      assert.equal(sites.rows.length, 4);
      await client.query(
        `INSERT INTO deliveries (site_id, driver)
         VALUES ($1, $3), ($1, $3), ($2, $3)`,
        [sites.rows[0].id, sites.rows[1].id, legacyName],
      );
      return sites.rows.map((site) => site.id);
    },
  )) as string[];
  return {
    legacyName,
    similarLegacyNames,
    similarityGroup: legacyDriverSimilarityKey(similarLegacyNames[0]),
    siteIds: result,
  };
}

async function cleanupLegacyMappingFixture(
  fixture: LegacyMappingFixture | undefined,
) {
  if (!fixture) return;
  await withBoundedDatabaseClient(
    "delete legacy driver mapping fixture",
    async (client) => {
      const deleted = (await client.query(
        "DELETE FROM sites WHERE id = ANY($1::uuid[]) RETURNING id",
        [fixture.siteIds],
      )) as { rows: Array<{ id: string }> };
      assert.equal(deleted.rows.length, fixture.siteIds.length);

      const remaining = (await client.query(
        `SELECT
           (SELECT count(*)::int
              FROM sites
             WHERE id = ANY($1::uuid[])) AS sites,
           (SELECT count(*)::int
              FROM deliveries
             WHERE site_id = ANY($1::uuid[])) AS deliveries`,
        [fixture.siteIds],
      )) as { rows: Array<{ sites: number; deliveries: number }> };
      assert.deepEqual(remaining.rows, [{ sites: 0, deliveries: 0 }]);
    },
  );
}

async function createLegacyReviewMetadataFixture(
  reviewer: CreatedSmokeUser,
): Promise<LegacyReviewMetadataFixture> {
  const suffix = randomUUID();
  const reviewedNames = [
    `Smoke Review ${suffix}`,
    `Smoke.Review ${suffix}`,
  ].sort((left, right) => left.localeCompare(right, "ru"));
  const unreviewedNames = [
    `Smoke Pending ${suffix}`,
    `Smoke.Pending ${suffix}`,
  ];
  const legacyReviewedNames = [
    `Smoke Legacy ${suffix}`,
    `Smoke.Legacy ${suffix}`,
  ].sort((left, right) => left.localeCompare(right, "ru"));
  const deletedAuthorNames = [
    `Smoke Deleted ${suffix}`,
    `Smoke.Deleted ${suffix}`,
  ].sort((left, right) => left.localeCompare(right, "ru"));
  const reviewedGroup = legacyDriverSimilarityKey(reviewedNames[0]);
  const legacyReviewedGroup = legacyDriverSimilarityKey(legacyReviewedNames[0]);
  const deletedAuthorGroup = legacyDriverSimilarityKey(deletedAuthorNames[0]);
  const unnamedAuthorGroup = `unnamed-review-author-${randomUUID()}`;
  const unnamedAuthorId = randomUUID();
  const unreviewedGroup = legacyDriverSimilarityKey(unreviewedNames[0]);
  const reviewerName = reviewer.name;

  const siteIds = (await withBoundedDatabaseClient(
    "create legacy review metadata fixture",
    async (client) => {
      const clientResult = (await client.query(
        "SELECT id, name FROM clients ORDER BY id LIMIT 1",
      )) as { rows: Array<{ id: string; name: string }> };
      const clientId = clientResult.rows[0]?.id;
      const clientName = clientResult.rows[0]?.name;
      assert(clientId, "Legacy review smoke requires an existing client");
      assert(clientName, "Legacy review smoke requires a named client");
      const sites = (await client.query(
        `INSERT INTO sites
          (name, address, branch, client, client_id, manager, director, project, driver)
         VALUES
          ($1, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $2),
          ($3, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $4),
          ($5, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $6),
           ($7, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $8),
           ($9, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $10),
           ($11, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $12),
           ($13, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $14),
           ($15, 'Smoke address', 'Smoke branch', $18, $17, 'Smoke manager', 'Smoke director', 'Smoke project', $16)
         RETURNING id`,
        [
          `Smoke reviewed site ${randomUUID()}`,
          reviewedNames[0],
          `Smoke reviewed site ${randomUUID()}`,
          reviewedNames[1],
          `Smoke unreviewed site ${randomUUID()}`,
          unreviewedNames[0],
          `Smoke unreviewed site ${randomUUID()}`,
          unreviewedNames[1],
          `Smoke legacy reviewed site ${randomUUID()}`,
          legacyReviewedNames[0],
          `Smoke legacy reviewed site ${randomUUID()}`,
          legacyReviewedNames[1],
          `Smoke deleted-author site ${randomUUID()}`,
          deletedAuthorNames[0],
          `Smoke deleted-author site ${randomUUID()}`,
          deletedAuthorNames[1],
          clientId,
          clientName,
        ],
      )) as { rows: Array<{ id: string }> };
      assert.equal(sites.rows.length, 8);
      const deletedAuthor = (await client.query(
        `INSERT INTO app_users
           (clerk_user_id, email, name, role, editable_sections)
         VALUES ($1, $2, $3, 'admin'::user_role, ARRAY[]::text[])
         RETURNING id`,
        [
          `deleted-review-author-${randomUUID()}`,
          `deleted-review-author-${randomUUID()}@example.com`,
          `Deleted review author ${suffix}`,
        ],
      )) as { rows: Array<{ id: string }> };
      await client.query(
        `INSERT INTO app_users
           (id, clerk_user_id, email, name, role, editable_sections)
         VALUES ($1, $2, $3, NULL, 'admin'::user_role, ARRAY[]::text[])`,
        [
          unnamedAuthorId,
          `unnamed-review-author-${randomUUID()}`,
          `unnamed-review-author-${randomUUID()}@example.com`,
        ],
      );
      await client.query(
        `INSERT INTO legacy_driver_similarity_reviews
           (similarity_group, legacy_names, reviewed_by, reviewed_by_name_snapshot)
          VALUES
           ($1, $2::text[], $3, $4),
            ($5, $6::text[], $3, NULL),
             ($7, $8::text[], $9, NULL),
             ($10, ARRAY['unnamed author'], $11, NULL)`,
        [
          reviewedGroup,
          reviewedNames,
          reviewer.appUserId,
          reviewerName,
          legacyReviewedGroup,
          legacyReviewedNames,
          deletedAuthorGroup,
          deletedAuthorNames,
          deletedAuthor.rows[0]?.id,
          unnamedAuthorGroup,
          unnamedAuthorId,
        ],
      );
      await client.query("DELETE FROM app_users WHERE id = $1", [
        deletedAuthor.rows[0]?.id,
      ]);
      return sites.rows.map((site) => site.id);
    },
  )) as string[];

  return {
    reviewedGroup,
    legacyReviewedGroup,
    deletedAuthorGroup,
    unnamedAuthorGroup,
    unnamedAuthorId,
    unreviewedGroup,
    reviewerName,
    siteIds,
  };
}

async function deleteLegacyReviewAuthor(reviewer: CreatedSmokeUser) {
  await withBoundedDatabaseClient("delete legacy review author", (client) =>
    client.query("DELETE FROM app_users WHERE id = $1", [reviewer.appUserId]),
  );
}

async function cleanupLegacyReviewMetadataFixture(
  fixture: LegacyReviewMetadataFixture | undefined,
) {
  if (!fixture) return;
  await withBoundedDatabaseClient(
    "delete legacy review metadata fixture",
    async (client) => {
      await client.query("DELETE FROM sites WHERE id = ANY($1::uuid[])", [
        fixture.siteIds,
      ]);
      await client.query(
        "DELETE FROM legacy_driver_similarity_reviews WHERE similarity_group = ANY($1::text[])",
        [
          [
            fixture.reviewedGroup,
            fixture.legacyReviewedGroup,
            fixture.deletedAuthorGroup,
            fixture.unnamedAuthorGroup,
          ],
        ],
      );
      await client.query("DELETE FROM app_users WHERE id = $1", [
        fixture.unnamedAuthorId,
      ]);
    },
  );
}

async function backfillAndAssertLegacyReviewAuthorNames(
  fixture: LegacyReviewMetadataFixture,
) {
  await withBoundedDatabaseClient(
    "backfill legacy review author names twice",
    async (client) => {
      const firstBackfill = (await client.query(
        BACKFILL_LEGACY_REVIEW_AUTHOR_NAMES_SQL,
      )) as { rowCount?: number | null };
      assert.equal(firstBackfill.rowCount, 1);

      const secondBackfill = (await client.query(
        BACKFILL_LEGACY_REVIEW_AUTHOR_NAMES_SQL,
      )) as { rowCount?: number | null };
      assert.equal(secondBackfill.rowCount, 0);

      const snapshots = (await client.query(
        `SELECT similarity_group AS "similarityGroup",
                reviewed_by_name_snapshot AS "reviewedByNameSnapshot"
           FROM legacy_driver_similarity_reviews
          WHERE similarity_group = ANY($1::text[])
          ORDER BY similarity_group`,
        [
          [
            fixture.reviewedGroup,
            fixture.legacyReviewedGroup,
            fixture.deletedAuthorGroup,
            fixture.unnamedAuthorGroup,
          ],
        ],
      )) as {
        rows: Array<{
          similarityGroup: string;
          reviewedByNameSnapshot: string | null;
        }>;
      };
      assert.deepEqual(
        new Map(
          snapshots.rows.map((row) => [
            row.similarityGroup,
            row.reviewedByNameSnapshot,
          ]),
        ),
        new Map([
          [fixture.reviewedGroup, fixture.reviewerName],
          [fixture.legacyReviewedGroup, fixture.reviewerName],
          [fixture.deletedAuthorGroup, null],
          [fixture.unnamedAuthorGroup, null],
        ]),
      );
    },
  );
}

async function assertLegacyMappingApplied(
  fixture: LegacyMappingFixture,
  driverUserId: string,
) {
  const result = (await withBoundedDatabaseClient(
    "verify legacy driver mapping fixture",
    (client) =>
      client.query(
        `SELECT
           (SELECT count(*)::int
              FROM sites
             WHERE id = ANY($1::uuid[]) AND driver_user_id = $2) AS sites,
           (SELECT count(*)::int
              FROM deliveries
             WHERE site_id = ANY($1::uuid[]) AND driver_user_id = $2) AS deliveries`,
        [fixture.siteIds, driverUserId],
      ),
  )) as { rows: Array<{ sites: number; deliveries: number }> };
  assert.deepEqual(result.rows, [{ sites: 2, deliveries: 3 }]);
}

async function discoverUnknownClerkUsers(emails: string[]) {
  const clerkUserIds = new Set(
    createdUsers
      .map((user) => user.clerkUserId)
      .filter((userId): userId is string => Boolean(userId)),
  );

  const unresolvedEmails = emails.filter(
    (email) => !createdUsers.find((user) => user.email === email)?.clerkUserId,
  );
  for (const email of unresolvedEmails) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const page = await withTimeout(
          clerk.users.getUserList({ emailAddress: [email], limit: 10 }),
          10_000,
          "find temporary Clerk user during cleanup",
        );
        for (const user of page.data) clerkUserIds.add(user.id);
        if (page.data.length > 0 || !inFlightClerkCreations.has(email)) break;
      } catch (error) {
        lastError = error;
        if (attempt === 5) throw error;
      }
      await delay(500 * (attempt + 1));
    }
    if (lastError && inFlightClerkCreations.has(email)) {
      throw lastError;
    }
  }
  return clerkUserIds;
}

async function cleanupClerkUsers(emails: string[]) {
  const inFlightResults = await Promise.allSettled(
    [...inFlightClerkCreations.values()].map((creation) =>
      withTimeout(
        creation,
        20_000,
        "settle temporary Clerk user creation before cleanup",
      ),
    ),
  );
  const cleanupErrors = inFlightResults
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => result.reason);

  let clerkUserIds = new Set(
    createdUsers
      .map((user) => user.clerkUserId)
      .filter((userId): userId is string => Boolean(userId)),
  );
  try {
    clerkUserIds = await discoverUnknownClerkUsers(emails);
  } catch (error) {
    cleanupErrors.push(error);
  }

  const deletionResults = await Promise.allSettled(
    [...clerkUserIds].map(async (userId) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await withTimeout(
            clerk.users.deleteUser(userId),
            10_000,
            "delete temporary Clerk user",
          );
          return;
        } catch (error) {
          lastError = error;
          await delay(500 * (attempt + 1));
        }
      }
      throw lastError;
    }),
  );
  for (const result of deletionResults) {
    if (result.status === "rejected") cleanupErrors.push(result.reason);
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "One or more temporary Clerk users could not be cleaned up",
    );
  }
}

async function withBoundedDatabaseClient<T>(
  description: string,
  operation: (client: DatabaseClient) => Promise<T>,
) {
  const connect = pool.connect();
  let client;
  try {
    client = await withTimeout(connect, 5_000, `connect to ${description}`);
  } catch (error) {
    void connect
      .then((lateClient) => lateClient.release())
      .catch(() => undefined);
    throw error;
  }

  let destroyClient = false;
  try {
    await withTimeout(
      client.query("SET statement_timeout = '10s'"),
      5_000,
      `set ${description} statement timeout`,
    );
    await withTimeout(
      client.query("SET lock_timeout = '5s'"),
      5_000,
      `set ${description} lock timeout`,
    );
    return await withTimeout(operation(client), 12_000, description);
  } catch (error) {
    destroyClient = true;
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

async function readAutomaticCleanupStatus(
  client: DatabaseClient,
): Promise<CleanupStatusSnapshot | null> {
  const result = (await client.query(
    `SELECT
         last_run_at AS "lastRunAt",
         last_successful_run_at AS "lastSuccessfulRunAt",
         status,
         failure_kind AS "failureKind",
         consecutive_failures AS "consecutiveFailures",
         scanned,
         candidates,
         deleted,
         resumed_photo_deletions AS "resumedPhotoDeletions",
         resumed_delivery_deletions AS "resumedDeliveryDeletions",
         failed,
         updated_at AS "updatedAt"
       FROM delivery_upload_cleanup_status
       WHERE key = 'automatic'
       LIMIT 1`,
  )) as { rows: CleanupStatusSnapshot[] };
  return result.rows[0] ?? null;
}

async function writeAutomaticCleanupStatus(
  client: DatabaseClient,
  status: CleanupStatusSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO delivery_upload_cleanup_status
         (key, last_run_at, last_successful_run_at, status, failure_kind, consecutive_failures, scanned, candidates, deleted, resumed_photo_deletions, resumed_delivery_deletions, failed, updated_at)
       VALUES ('automatic', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (key) DO UPDATE SET
         last_run_at = EXCLUDED.last_run_at,
         last_successful_run_at = EXCLUDED.last_successful_run_at,
         status = EXCLUDED.status,
          failure_kind = EXCLUDED.failure_kind,
          consecutive_failures = EXCLUDED.consecutive_failures,
         scanned = EXCLUDED.scanned,
         candidates = EXCLUDED.candidates,
         deleted = EXCLUDED.deleted,
         resumed_photo_deletions = EXCLUDED.resumed_photo_deletions,
         resumed_delivery_deletions = EXCLUDED.resumed_delivery_deletions,
         failed = EXCLUDED.failed,
         updated_at = EXCLUDED.updated_at`,
    [
      status.lastRunAt,
      status.lastSuccessfulRunAt,
      status.status,
      status.failureKind,
      status.consecutiveFailures,
      status.scanned,
      status.candidates,
      status.deleted,
      status.resumedPhotoDeletions,
      status.resumedDeliveryDeletions,
      status.failed,
      status.updatedAt,
    ],
  );
}

async function restoreAutomaticCleanupStatus(
  client: DatabaseClient,
  status: CleanupStatusSnapshot | null,
): Promise<void> {
  if (status) {
    await writeAutomaticCleanupStatus(client, status);
    return;
  }
  await client.query(
    "DELETE FROM delivery_upload_cleanup_status WHERE key = 'automatic'",
  );
}

async function withAutomaticCleanupStatusFixture(
  run: (
    writeStatus: (status: CleanupStatusSnapshot) => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const connect = pool.connect();
  let client: DatabaseClient;
  try {
    client = await withTimeout(
      connect,
      5_000,
      "connect to cleanup status fixture",
    );
  } catch (error) {
    void connect
      .then((lateClient) => lateClient.release())
      .catch(() => undefined);
    throw error;
  }

  let destroyClient = false;
  let lockAcquired = false;
  let statusLockAcquired = false;
  let originalStatus: CleanupStatusSnapshot | null | undefined;
  try {
    await withTimeout(
      client.query("SET statement_timeout = '10s'"),
      5_000,
      "set cleanup status fixture statement timeout",
    );
    await withTimeout(
      client.query("SET lock_timeout = '5s'"),
      5_000,
      "set cleanup status fixture lock timeout",
    );
    await withTimeout(
      client.query(
        `SELECT pg_advisory_lock(
           hashtextextended($1, $2)
         )`,
        [
          `${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_LOCK_NAME}`,
          DELIVERY_UPLOAD_LOCK_SEED,
        ],
      ),
      7_000,
      "acquire cleanup status fixture advisory lock",
    );
    lockAcquired = true;
    await withTimeout(
      client.query(
        `SELECT pg_advisory_lock(
           hashtextextended($1, $2)
         )`,
        [
          `${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_STATUS_LOCK_NAME}`,
          DELIVERY_UPLOAD_LOCK_SEED,
        ],
      ),
      7_000,
      "acquire cleanup status persistence advisory lock",
    );
    statusLockAcquired = true;
    originalStatus = await withTimeout(
      readAutomaticCleanupStatus(client),
      12_000,
      "snapshot automatic cleanup status",
    );
    await run((status) =>
      withTimeout(
        writeAutomaticCleanupStatus(client, status),
        12_000,
        "write temporary automatic cleanup status",
      ),
    );
  } catch (error) {
    destroyClient = true;
    throw error;
  } finally {
    try {
      if (originalStatus !== undefined) {
        await withTimeout(
          restoreAutomaticCleanupStatus(client, originalStatus),
          12_000,
          "restore automatic cleanup status",
        );
      }
      if (lockAcquired) {
        if (statusLockAcquired) {
          await withTimeout(
            client.query(
              `SELECT pg_advisory_unlock(
                 hashtextextended($1, $2)
               )`,
              [
                `${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_STATUS_LOCK_NAME}`,
                DELIVERY_UPLOAD_LOCK_SEED,
              ],
            ),
            5_000,
            "release cleanup status persistence advisory lock",
          );
        }
        await withTimeout(
          client.query(
            `SELECT pg_advisory_unlock(
               hashtextextended($1, $2)
             )`,
            [
              `${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_LOCK_NAME}`,
              DELIVERY_UPLOAD_LOCK_SEED,
            ],
          ),
          5_000,
          "release cleanup status fixture advisory lock",
        );
      }
    } catch (cleanupError) {
      destroyClient = true;
      throw cleanupError;
    } finally {
      client.release(destroyClient);
    }
  }
}

async function boundedDatabaseDelete(
  table: "app_users" | "user_invites",
  emails: string[],
) {
  await withBoundedDatabaseClient(
    `delete temporary ${table} records`,
    (client) =>
      client.query(`DELETE FROM ${table} WHERE email = ANY($1::text[])`, [
        emails,
      ]),
  );
}

async function cleanupSmokeUsers() {
  const emails = createdUsers.map((user) => user.email);
  if (emails.length === 0) return;

  const cleanupResults = await Promise.allSettled([
    cleanupClerkUsers(emails),
    boundedDatabaseDelete("user_invites", emails),
    boundedDatabaseDelete("app_users", emails),
  ]);
  const cleanupErrors = cleanupResults
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => result.reason);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "One or more temporary role-smoke records could not be cleaned up",
    );
  }
}

let cleanupPromise: Promise<void> | undefined;
function cleanupOnce() {
  cleanupPromise ??= cleanupSmokeUsers();
  return cleanupPromise;
}

let activeBrowser: BrowserSession | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    cancellationSignal = signal;
    void activeBrowser?.close();
    void browserStartupCleanup?.();
  });
}

async function main() {
  let primaryError: unknown;
  let mappingFixture: LegacyMappingFixture | undefined;
  let reviewMetadataFixture: LegacyReviewMetadataFixture | undefined;
  let driverAccessFixture: DriverAccessFixture | undefined;
  try {
    await waitForApp();

    await withBrowser(async (browser) => {
      await browser.navigate(`${baseUrl}/deliveries/run`);
      await browser.waitUntil(
        "location.pathname === '/sign-in'",
        "anonymous redirect to /sign-in",
      );
      assert.equal(await browser.apiStatus("/api/users/me"), 401);
    });
    console.log("✓ anonymous user is redirected to sign-in");

    const viewer = await createSmokeUser("viewer", ["deliveries"]);
    await withBrowser(async (browser) => {
      await browser.signIn(viewer.clerkUserId);
      assert.equal(
        await browser.apiStatus("/api/audit/delivery-upload-cleanup"),
        403,
      );
      assert.equal(
        await browser.apiStatus("/api/deliveries/bulk", {
          method: "POST",
          body: {},
        }),
        403,
      );
      await browser.navigate(`${baseUrl}/deliveries/run`);
      await browser.waitUntil(
        "location.pathname === '/deliveries'",
        "legacy viewer/manager redirect away from /deliveries/run",
      );
      assert.equal(await browser.evaluate("location.pathname"), "/deliveries");
      assert.equal(
        await browser.apiStatus("/api/admin/legacy-driver-assignments"),
        403,
      );
    });
    console.log("✓ viewer cannot call legacy mapping");

    const editor = await createSmokeUser("editor", ["deliveries", "sites"]);
    await withBrowser(async (browser) => {
      await browser.signIn(editor.clerkUserId);
      assert.equal(await browser.apiStatus("/api/deliveries"), 200);
      assert.equal(
        await browser.apiStatus("/api/deliveries/bulk", {
          method: "POST",
          body: {},
        }),
        403,
      );
      await browser.navigate(`${baseUrl}/deliveries/run`);
      await browser.waitUntil(
        "location.pathname === '/deliveries/run' && document.querySelector('[data-testid=\"text-page-title\"]')",
        "legacy editor/logistician delivery-run access",
      );
      await browser.navigate(`${baseUrl}/sites`);
      await browser.waitUntil(
        `location.pathname === '/sites' &&
         document.querySelector('[data-testid="text-page-title"]')`,
        "ordinary editor sites-page access",
      );
      assert.equal(
        await browser.evaluate(
          `Boolean(document.querySelector('[data-testid="button-open-legacy-mapping"]'))`,
        ),
        false,
      );
    });
    console.log("✓ ordinary role cannot see the legacy mapping button");
    console.log("✓ legacy editor with deliveries access reaches delivery run");

    const admin = await createSmokeUser("admin", []);
    const roleDriver = await createSmokeUser("driver", []);
    const driver = await createSmokeUser("viewer", [], { isDriver: true });
    const ordinaryUser = await createSmokeUser("viewer", []);
    driverAccessFixture = await createDriverAccessFixture(roleDriver, driver);
    const activeDriverAccessFixture = driverAccessFixture;
    await assertDriverRouteAccess(
      roleDriver,
      activeDriverAccessFixture.roleDriverDeliveryId,
      activeDriverAccessFixture.legacyDriverDeliveryId,
    );
    await assertDriverRouteAccess(
      driver,
      activeDriverAccessFixture.legacyDriverDeliveryId,
      activeDriverAccessFixture.roleDriverDeliveryId,
    );
    await withBrowser(async (browser) => {
      await browser.signIn(ordinaryUser.clerkUserId);
      assert.equal(await browser.apiStatus("/api/my/deliveries"), 403);
      assert.equal(
        await browser.apiStatus(
          `/api/deliveries/${activeDriverAccessFixture.roleDriverDeliveryId}/photos`,
        ),
        403,
      );
    });
    console.log(
      "✓ role driver and legacy isDriver share own-route and act access while an ordinary user is denied",
    );
    const reviewAuthor = await createSmokeUser("admin", []);
    mappingFixture = await createLegacyMappingFixture();
    reviewMetadataFixture =
      await createLegacyReviewMetadataFixture(reviewAuthor);
    await backfillAndAssertLegacyReviewAuthorNames(reviewMetadataFixture);
    const activeMappingFixture = mappingFixture;
    const activeReviewMetadataFixture = reviewMetadataFixture;
    await withAutomaticCleanupStatusFixture(async (writeStatus) => {
      const staleRunAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await writeStatus({
        lastRunAt: staleRunAt,
        lastSuccessfulRunAt: null,
        status: "failed",
        failureKind: "other",
        consecutiveFailures: 1,
        scanned: 7,
        candidates: 3,
        deleted: 2,
        resumedPhotoDeletions: 0,
        resumedDeliveryDeletions: 0,
        failed: 1,
        updatedAt: staleRunAt,
      });

      await withBrowser(async (browser) => {
        await browser.signIn(admin.clerkUserId);
        assert.equal(await browser.apiStatus("/api/users"), 200);
        await browser.navigate(`${baseUrl}/sites`);
        await browser.waitUntil(
          `location.pathname === '/sites' &&
           document.querySelector('[data-testid="button-open-legacy-mapping"]')`,
          "admin-only legacy mapping button",
        );
        await browser.waitUntil(
          `(() => {
            const text = document.querySelector(
              '[data-testid="button-open-legacy-mapping"]'
            )?.textContent;
            const count = text?.match(/\\((\\d+)\\)/)?.[1];
            return count !== undefined && Number(count) > 0;
          })()`,
          "legacy assignment count to include the fixture",
        );
        const buttonTextBefore = await browser.text(
          "button-open-legacy-mapping",
        );
        const assignmentCountBefore = Number(
          buttonTextBefore.match(/\((\d+)\)/)?.[1],
        );
        assert(Number.isInteger(assignmentCountBefore));

        await browser.click("button-open-legacy-mapping");
        await browser.waitUntil(
          `document.querySelector(
            '[data-testid=' + JSON.stringify(${JSON.stringify(`mapping-row-${activeMappingFixture.legacyName}`)}) + ']'
          )`,
          "isolated legacy mapping row",
        );
        const reviewMetaTestId = `similarity-review-meta-${activeReviewMetadataFixture.reviewedGroup}`;
        const legacyReviewMetaTestId = `similarity-review-meta-${activeReviewMetadataFixture.legacyReviewedGroup}`;
        const deletedAuthorReviewMetaTestId = `similarity-review-meta-${activeReviewMetadataFixture.deletedAuthorGroup}`;
        await browser.waitUntil(
          `Boolean(document.querySelector(
            '[data-testid=' + JSON.stringify(${JSON.stringify(reviewMetaTestId)}) + ']'
          ))`,
          "review metadata with its current author",
        );
        const reviewMetaBeforeAuthorDeletion =
          await browser.text(reviewMetaTestId);
        const legacyReviewMetaBeforeAuthorDeletion = await browser.text(
          legacyReviewMetaTestId,
        );
        assert.match(
          reviewMetaBeforeAuthorDeletion,
          new RegExp(
            `${activeReviewMetadataFixture.reviewerName},\\s+\\d{1,2}\\s+\\p{L}+\\.?\\s+\\d{4}\\s+г\\.,\\s+\\d{2}:\\d{2}`,
            "u",
          ),
        );
        assert.match(
          legacyReviewMetaBeforeAuthorDeletion,
          new RegExp(activeReviewMetadataFixture.reviewerName),
        );
        assert.match(
          await browser.text(deletedAuthorReviewMetaTestId),
          /администратор удалён, /,
        );
        assert.equal(
          await browser.evaluate(
            `Boolean(document.querySelector(
              '[data-testid=' + JSON.stringify(${JSON.stringify(
                `similarity-group-${activeReviewMetadataFixture.unreviewedGroup}`,
              )}) + ']'
            ))`,
          ),
          true,
        );
        assert.equal(
          await browser.evaluate(
            `Boolean(document.querySelector(
              '[data-testid=' + JSON.stringify(${JSON.stringify(
                `similarity-review-meta-${activeReviewMetadataFixture.unreviewedGroup}`,
              )}) + ']'
            ))`,
          ),
          false,
        );
        await browser.click("button-cancel-mapping");
        await deleteLegacyReviewAuthor(reviewAuthor);
        await browser.click("button-open-legacy-mapping");
        await browser.waitUntil(
          `(() => {
            const element = document.querySelector(
              '[data-testid=' + JSON.stringify(${JSON.stringify(reviewMetaTestId)}) + ']'
            );
            return Boolean(
              element &&
               element.textContent?.includes(
                 ${JSON.stringify(`${activeReviewMetadataFixture.reviewerName} (учётная запись удалена)`)}
               )
            );
          })()`,
          "historical review metadata after author deletion",
        );
        const reviewMetaAfterAuthorDeletion =
          await browser.text(reviewMetaTestId);
        assert.match(
          reviewMetaAfterAuthorDeletion,
          new RegExp(
            `${activeReviewMetadataFixture.reviewerName} \\(учётная запись удалена\\)`,
          ),
        );
        assert.equal(
          reviewMetaAfterAuthorDeletion,
          reviewMetaBeforeAuthorDeletion.replace(
            `${activeReviewMetadataFixture.reviewerName}, `,
            `${activeReviewMetadataFixture.reviewerName} (учётная запись удалена), `,
          ),
        );
        const legacyReviewMetaAfterAuthorDeletion = await browser.text(
          legacyReviewMetaTestId,
        );
        assert.equal(
          legacyReviewMetaAfterAuthorDeletion,
          legacyReviewMetaBeforeAuthorDeletion.replace(
            `${activeReviewMetadataFixture.reviewerName}, `,
            `${activeReviewMetadataFixture.reviewerName} (учётная запись удалена), `,
          ),
        );
        assert.match(
          await browser.text(`mapping-row-${activeMappingFixture.legacyName}`),
          /5 записей\s*Объектов: 2 • Доставок: 3/,
        );
        await browser.waitUntil(
          `(() => {
            const group = document.querySelector(
              '[data-testid=' + JSON.stringify(${JSON.stringify(`similarity-group-${activeMappingFixture.similarityGroup}`)}) + ']'
            );
            const rowIds = Array.from(
              group?.querySelectorAll(':scope > [data-testid^="mapping-row-"]') ?? []
            ).map((row) => row.getAttribute('data-testid'));
            const expectedRowIds = ${JSON.stringify(
              activeMappingFixture.similarLegacyNames.map(
                (name) => `mapping-row-${name}`,
              ),
            )};
            return rowIds.length === expectedRowIds.length &&
              expectedRowIds.every((rowId) => rowIds.includes(rowId));
          })()`,
          "similar legacy names grouped together",
        );
        for (const similarLegacyName of activeMappingFixture.similarLegacyNames) {
          assert.match(
            await browser.text(`select-driver-${similarLegacyName}`),
            /Выберите водителя/,
          );
        }

        await browser.click(`select-driver-${activeMappingFixture.legacyName}`);
        await browser.click(`select-option-driver-${driver.appUserId}`);
        await browser.click("switch-show-possible-duplicates");
        await browser.waitUntil(
          `(() => {
            const isolated = document.querySelector(
              '[data-testid=' + JSON.stringify(${JSON.stringify(`mapping-row-${activeMappingFixture.legacyName}`)}) + ']'
            );
            const duplicateRows = ${JSON.stringify(
              activeMappingFixture.similarLegacyNames.map(
                (name) => `mapping-row-${name}`,
              ),
            )}.every((testId) =>
              document.querySelector('[data-testid=' + JSON.stringify(testId) + ']')
            );
            return !isolated && duplicateRows;
          })()`,
          "duplicate filter to hide isolated name and keep both grouped names",
        );
        for (const similarLegacyName of activeMappingFixture.similarLegacyNames) {
          assert.match(
            await browser.text(`select-driver-${similarLegacyName}`),
            /Выберите водителя/,
          );
        }
        await browser.click("switch-show-possible-duplicates");
        await browser.waitUntil(
          `document.querySelector(
            '[data-testid=' + JSON.stringify(${JSON.stringify(`mapping-row-${activeMappingFixture.legacyName}`)}) + ']'
          )`,
          "isolated legacy mapping row after disabling duplicate filter",
        );
        assert.doesNotMatch(
          await browser.text(
            `select-driver-${activeMappingFixture.legacyName}`,
          ),
          /Выберите водителя/,
        );

        await browser.click("button-apply-mapping");
        await browser.waitUntil(
          `Boolean(document.querySelector('[data-testid="dialog-mapping-confirm"]'))`,
          "mapping confirmation",
        );
        assert.match(
          await browser.text("dialog-mapping-confirm"),
          /сопоставление для 1 имени.*Затрагивается объектов: 2.*Затрагивается доставок: 3/s,
        );
        await browser.click("button-confirm-mapping");
        await browser.waitUntil(
          `Boolean(document.querySelector('[data-testid="mapping-success-result"]'))`,
          "mapping success result after React render",
        );
        assert.match(
          await browser.text("mapping-success-result"),
          /Обновлено объектов: 2.*Обновлено доставок: 3.*Всего назначений: 5/s,
        );
        await assertLegacyMappingApplied(
          activeMappingFixture,
          driver.appUserId,
        );
        await browser.click("button-close-mapping");
        await browser.waitUntil(
          `!document.querySelector('[data-testid="dialog-legacy-mapping"]')`,
          "mapping dialog to close",
        );
        await browser.waitUntil(
          `(() => {
            const button = document.querySelector(
              '[data-testid="button-open-legacy-mapping"]'
            );
            return Boolean(
              button?.textContent?.includes(
                ${JSON.stringify(`(${assignmentCountBefore - 1})`)}
              )
            );
          })()`,
          "legacy assignment count to update without reload",
        );
        await browser.click("button-open-legacy-mapping");
        await browser.waitUntil(
          `Boolean(document.querySelector('[data-testid="mapping-list"], [data-testid="mapping-empty"]'))`,
          "refetched legacy assignment list",
        );
        assert.equal(
          await browser.evaluate(
            `Boolean(document.querySelector(
              '[data-testid=' + JSON.stringify(${JSON.stringify(`mapping-row-${activeMappingFixture.legacyName}`)}) + ']'
            ))`,
          ),
          false,
        );
        await browser.click("button-cancel-mapping");

        await browser.navigate(`${baseUrl}/users`);
        await browser.waitUntil(
          "location.pathname === '/users' && document.querySelector('[data-testid=\"text-page-title\"]')",
          "admin users-page access",
        );

        await browser.navigate(`${baseUrl}/audit`);
        await browser.waitUntil(
          `location.pathname === '/audit' &&
           document.querySelector(
             '[data-testid="audit-page"][data-cleanup-health-state="stale"]'
           ) &&
           document.querySelector('[data-testid="alert-delivery-upload-cleanup"]')`,
          "stale cleanup warning for admin",
        );
        const staleWarning = await browser.evaluate<string>(
          `(() => {
            const alert = document.querySelector(
              '[data-testid="alert-delivery-upload-cleanup"]'
            );
            if (!alert) return "";
            return Array.from(alert.children)
              .map((child) => child.textContent?.trim() ?? "")
              .filter(Boolean)
              .join(" ")
              .replace(/\\s+/g, " ")
              .trim();
          })()`,
        );
        assert.match(
          staleWarning,
          /^Уборка загруженных файлов требует внимания Успешная автоматическая сверка ещё не зарегистрирована\. Последняя попытка: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}\. Проверено: 7, удалено: 2, ошибок: 1\.$/,
        );

        const freshRunAt = new Date();
        await writeStatus({
          lastRunAt: freshRunAt,
          lastSuccessfulRunAt: freshRunAt,
          status: "success",
          failureKind: "none",
          consecutiveFailures: 0,
          scanned: 8,
          candidates: 0,
          deleted: 0,
          resumedPhotoDeletions: 0,
          resumedDeliveryDeletions: 0,
          failed: 0,
          updatedAt: freshRunAt,
        });
        await browser.navigate(`${baseUrl}/audit`);
        await browser.waitUntil(
          `location.pathname === '/audit' &&
           document.querySelector(
             '[data-testid="audit-page"][data-cleanup-health-state="fresh"]'
           ) &&
           !document.querySelector('[data-testid="alert-delivery-upload-cleanup"]')`,
          "cleanup warning to disappear after a fresh success",
        );
      });
    });
    console.log("✓ admin reaches users page");
    console.log(
      "✓ admin filters grouped legacy duplicates without losing manual selections",
    );
    console.log(
      "✓ admin maps an isolated legacy assignment through the rendered UI",
    );
    console.log(
      "✓ legacy review metadata survives author deletion in the rendered UI",
    );
    console.log(
      "✓ legacy review author backfill is idempotent and leaves deleted authors neutral",
    );
    console.log(
      "✓ cleanup warning appears when stale and disappears after success",
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      const cleanupResults = await Promise.allSettled([
        cleanupLegacyReviewMetadataFixture(reviewMetadataFixture),
        cleanupLegacyMappingFixture(mappingFixture),
        (async () => {
          await cleanupDriverAccessFixture(driverAccessFixture);
          await cleanupOnce();
        })(),
      ]);
      const cleanupErrors = cleanupResults
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason);
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          "One or more role-smoke fixtures could not be cleaned up",
        );
      }
      console.log("✓ temporary Clerk and database users cleaned up");
    } catch (cleanupError) {
      if (primaryError) {
        console.error("Cleanup also failed:", cleanupError);
      } else {
        throw cleanupError;
      }
    } finally {
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
