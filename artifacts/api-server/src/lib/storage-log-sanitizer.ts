export const PRIVATE_OBJECT_PATH_MARKER = "[PRIVATE_OBJECT_PATH]";

export type StorageLogOperation =
  | "request-upload-url"
  | "download-public-object"
  | "download-private-object"
  | "attach-delivery-act"
  | "delete-rejected-delivery-act"
  | "delete-delivery-act-object";

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactPathStartingWith(
  value: string,
  pathPrefix: string,
  replacement: string,
  flags = "g",
): string {
  const escapedPrefix = escapeRegularExpression(pathPrefix);
  return value.replace(
    new RegExp(`${escapedPrefix}[^\\r\\n]*`, flags),
    replacement,
  );
}

function redactKnownPrivatePrefix(
  value: string,
  pathPrefix: string,
  consumeLineBreaks = false,
): string {
  const encodedSeparatorPrefix = pathPrefix
    .split("/")
    .map(escapeRegularExpression)
    .join("(?:/|%2F)");
  const suffixPattern = consumeLineBreaks ? "[\\s\\S]*" : "[^\\r\\n]*";
  return value.replace(
    new RegExp(`${encodedSeparatorPrefix}${suffixPattern}`, "gi"),
    PRIVATE_OBJECT_PATH_MARKER,
  );
}

function sanitizePrivateStorageValue(
  value: string,
  privateObjectDir: string | undefined,
  consumeLineBreaks: boolean,
): string {
  let sanitized = redactKnownPrivatePrefix(
    value,
    "/objects/uploads/",
    consumeLineBreaks,
  );
  const normalizedPrivateDir = privateObjectDir?.replace(/\/+$/, "");
  if (!normalizedPrivateDir) return sanitized;

  const privateUploadPrefix = `${normalizedPrivateDir}/uploads/`;
  sanitized = redactKnownPrivatePrefix(
    sanitized,
    `https://storage.googleapis.com${privateUploadPrefix}`,
    consumeLineBreaks,
  );
  sanitized = redactKnownPrivatePrefix(
    sanitized,
    privateUploadPrefix,
    consumeLineBreaks,
  );
  if (privateUploadPrefix.startsWith("/")) {
    sanitized = redactKnownPrivatePrefix(
      sanitized,
      privateUploadPrefix.slice(1),
      consumeLineBreaks,
    );
  }
  return sanitized;
}

/**
 * Private upload object names can contain customer-provided filenames. Keep the
 * stable normalized path category visible, but never log the complete object
 * name or its physical bucket prefix.
 */
export function sanitizePrivateStorageText(
  value: string,
  privateObjectDir: string | undefined = process.env.PRIVATE_OBJECT_DIR,
): string {
  return sanitizePrivateStorageValue(value, privateObjectDir, false);
}

export function sanitizePrivateStorageRequestUrl(
  url: string | undefined,
  privateObjectDir: string | undefined = process.env.PRIVATE_OBJECT_DIR,
): string | undefined {
  if (url === undefined) return undefined;
  const path = url.split("?")[0];
  const decodedPath = path.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
  });
  const sanitizedDecodedPath = sanitizePrivateStorageValue(
    decodedPath,
    privateObjectDir,
    true,
  );
  if (sanitizedDecodedPath !== decodedPath) return sanitizedDecodedPath;
  return sanitizePrivateStorageValue(path, privateObjectDir, true);
}

export function sanitizePrivateStorageObjectPath(
  objectPath: string,
  privateObjectDir: string | undefined = process.env.PRIVATE_OBJECT_DIR,
): string {
  if (objectPath.startsWith("/objects/uploads/")) {
    return PRIVATE_OBJECT_PATH_MARKER;
  }

  const normalizedPrivateDir = privateObjectDir?.replace(/\/+$/, "");
  if (normalizedPrivateDir) {
    const privateUploadPrefix = `${normalizedPrivateDir}/uploads/`;
    if (
      objectPath.startsWith(privateUploadPrefix) ||
      objectPath.startsWith(
        `https://storage.googleapis.com${privateUploadPrefix}`,
      ) ||
      (privateUploadPrefix.startsWith("/") &&
        objectPath.startsWith(privateUploadPrefix.slice(1)))
    ) {
      return PRIVATE_OBJECT_PATH_MARKER;
    }
  }

  return sanitizePrivateStorageText(objectPath, privateObjectDir);
}

function getErrorProperty(error: unknown, property: string): unknown {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) {
    return undefined;
  }
  return property in error
    ? (error as Record<string, unknown>)[property]
    : undefined;
}

function getStorageErrorReason(error: unknown): string {
  const message = getErrorProperty(error, "message");
  if (typeof message === "string") return message;
  return String(error);
}

function getStorageErrorCode(
  error: unknown,
  privateObjectDir: string | undefined,
): string | number | undefined {
  for (const property of ["code", "statusCode", "status"]) {
    const value = getErrorProperty(error, property);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.length <= 64) {
      return sanitizePrivateStorageText(value, privateObjectDir);
    }
  }
  return undefined;
}

export function createStorageFailureLogFields({
  operation,
  error,
  objectPath,
  privateObjectDir = process.env.PRIVATE_OBJECT_DIR,
}: {
  operation: StorageLogOperation;
  error: unknown;
  objectPath?: string;
  privateObjectDir?: string;
}): {
  storageOperation: StorageLogOperation;
  storageCode?: string | number;
  reason: string;
  objectPath?: string;
  err: unknown;
} {
  const storageCode = getStorageErrorCode(error, privateObjectDir);
  return {
    storageOperation: operation,
    ...(storageCode === undefined ? {} : { storageCode }),
    reason: sanitizePrivateStorageText(
      getStorageErrorReason(error),
      privateObjectDir,
    ),
    ...(objectPath === undefined
      ? {}
      : {
          objectPath: sanitizePrivateStorageObjectPath(
            objectPath,
            privateObjectDir,
          ),
        }),
    err: error,
  };
}