import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";
import { once } from "node:events";

import express from "express";
import pinoHttp from "pino-http";

import {
  createLogger,
  serializeHttpRequestForLog,
} from "./logger.ts";
import {
  createStorageFailureLogFields,
  PRIVATE_OBJECT_PATH_MARKER,
  sanitizePrivateStorageRequestUrl,
  type StorageLogOperation,
} from "./storage-log-sanitizer.ts";

const PRIVATE_OBJECT_DIR = "/private-bucket/private-dir";

class StorageProviderError extends Error {
  code = 503;
}

function encodeCharacter(character: string, lowercaseHex: boolean): string {
  const hex = character.charCodeAt(0).toString(16).padStart(2, "0");
  return `%${lowercaseHex ? hex.toLowerCase() : hex.toUpperCase()}`;
}

function encodeSegment(
  segment: string,
  variant: number,
  lowercaseHex: boolean,
): string {
  return [...segment]
    .map((character, index) =>
      (index + variant) % 3 === 0
        ? encodeCharacter(character, lowercaseHex)
        : character,
    )
    .join("");
}

function generatePrivateRequestUrls(): string[] {
  const urls = new Set<string>();
  const separators = ["/", "%2F", "%2f"];
  const malformedSuffixes = ["", "%", "%Z1", "%1Z", "%C3%28"];

  for (let variant = 0; variant < 24; variant += 1) {
    const lowercaseHex = variant % 2 === 1;
    const separator = separators[variant % separators.length];
    const malformed = malformedSuffixes[variant % malformedSuffixes.length];
    const segments = ["api", "storage", "objects", "uploads"].map(
      (segment, index) =>
        encodeSegment(segment, variant + index, lowercaseHex),
    );
    const objectName = encodeSegment(
      `customer-secret-${variant}.pdf`,
      variant + 4,
      lowercaseHex,
    );
    urls.add(
      `/${segments.join(separator)}${separator}${objectName}${malformed}?download=1`,
    );

    const physicalSegments = [
      "storage.googleapis.com",
      "private-bucket",
      "private-dir",
      "uploads",
    ].map((segment, index) =>
      encodeSegment(segment, variant + index, lowercaseHex),
    );
    urls.add(
      `/api/storage/${encodeSegment("https:", variant, lowercaseHex)}${separator}${separator}${physicalSegments.join(separator)}${separator}${objectName}${malformed}?download=1`,
    );
  }

  return [...urls];
}

function captureStorageLog(
  operation: StorageLogOperation,
  objectPath: string | undefined,
): Record<string, unknown> {
  let output = "";
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const privateObjectDir = PRIVATE_OBJECT_DIR;
  const privateObjectName = "customer-contract-private.pdf";
  const error = new StorageProviderError(
    `Storage unavailable for ${privateObjectDir}/uploads/${privateObjectName}`,
  );
  const logger = createLogger(
    {
      NODE_ENV: "production",
      PRIVATE_OBJECT_DIR: privateObjectDir,
    },
    destination,
  );

  logger.error(
    createStorageFailureLogFields({
      operation,
      error,
      objectPath,
      privateObjectDir,
    }),
    "Storage operation failed",
  );

  assert.ok(output);
  assert.equal(output.includes(privateObjectName), false);
  assert.equal(output.includes(privateObjectDir), false);
  return JSON.parse(output) as Record<string, unknown>;
}

test("основные Storage-операции не раскрывают приватное имя и сохраняют контекст", () => {
  const operations: StorageLogOperation[] = [
    "request-upload-url",
    "download-private-object",
    "attach-delivery-act",
    "delete-rejected-delivery-act",
    "delete-delivery-act-object",
  ];

  for (const operation of operations) {
    const log = captureStorageLog(
      operation,
      operation === "request-upload-url"
        ? undefined
        : "/objects/uploads/customer-contract-private.pdf",
    );
    assert.equal(log.storageOperation, operation);
    assert.equal(log.storageCode, 503);
    assert.equal(
      log.reason,
      `Storage unavailable for ${PRIVATE_OBJECT_PATH_MARKER}`,
    );
    if (operation !== "request-upload-url") {
      assert.equal(log.objectPath, PRIVATE_OBJECT_PATH_MARKER);
    }
    const err = log.err as Record<string, unknown>;
    assert.equal(
      err.message,
      `Storage unavailable for ${PRIVATE_OBJECT_PATH_MARKER}`,
    );
  }
});

test("публичная операция сохраняет безопасный путь без ложной маскировки", () => {
  const log = captureStorageLog(
    "download-public-object",
    "manuals/public-guide.pdf",
  );
  assert.equal(log.objectPath, "manuals/public-guide.pdf");
  assert.equal(log.storageOperation, "download-public-object");
  assert.equal(log.storageCode, 503);
});

test("HTTP request-лог не раскрывает имя приватного объекта из кодированного URL", async () => {
  const privateRequestUrls = generatePrivateRequestUrls();
  assert.equal(privateRequestUrls.length, 48);
  const previousPrivateObjectDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = PRIVATE_OBJECT_DIR;
  let output = "";
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = createLogger(
    { NODE_ENV: "production" },
    destination,
  );
  const app = express();
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: serializeHttpRequestForLog,
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    for (const requestUrl of privateRequestUrls) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}${requestUrl}`,
      );
      assert.equal(response.status, 204);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousPrivateObjectDir === undefined) {
      delete process.env.PRIVATE_OBJECT_DIR;
    } else {
      process.env.PRIVATE_OBJECT_DIR = previousPrivateObjectDir;
    }
  }

  for (let variant = 0; variant < 24; variant += 1) {
    assert.equal(output.includes(`customer-secret-${variant}.pdf`), false);
  }
  assert.equal(output.includes(PRIVATE_OBJECT_DIR), false);
  assert.equal(output.includes("private-bucket"), false);
  const completedLogs = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((log) => log.msg === "request completed");
  assert.equal(completedLogs.length, privateRequestUrls.length);
  for (const completedLog of completedLogs) {
    const request = completedLog.req as Record<string, unknown>;
    assert.ok(
      request.url === `/api/storage${PRIVATE_OBJECT_PATH_MARKER}` ||
        request.url === `/api/storage/${PRIVATE_OBJECT_PATH_MARKER}`,
    );
  }
});

test("публичные URL с похожим кодированием не маскируются без приватного префикса", () => {
  for (let variant = 0; variant < 24; variant += 1) {
    const publicName = encodeSegment(
      `public-guide-${variant}.pdf`,
      variant,
      variant % 2 === 1,
    );
    const url = `/api/storage/public%2Fmanuals%2f${publicName}?download=1`;
    assert.equal(
      sanitizePrivateStorageRequestUrl(url, PRIVATE_OBJECT_DIR),
      url.split("?")[0],
    );
  }
});

test("URL sanitizer закрывает encoded-разделители и не ломается на неверном escape", () => {
  for (const url of [
    "/api/storage/objects%2Fuploads%2Fprivate-name.pdf",
    "/api/storage/objects/%75ploads/private-name.pdf",
    "/api/storage/objects/%75ploads/private-name%ZZ.pdf",
    "/api/storage/objects/uploads/%0Dprivate-name.pdf",
    "/api/storage/objects/uploads/%0Aprivate-name.pdf",
  ]) {
    const sanitized = sanitizePrivateStorageRequestUrl(url);
    assert.equal(sanitized?.includes("private-name"), false);
    assert.equal(sanitized, `/api/storage${PRIVATE_OBJECT_PATH_MARKER}`);
  }
});