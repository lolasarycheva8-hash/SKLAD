import pino, { type DestinationStream, type LoggerOptions } from "pino";
import {
  sanitizePrivateStorageRequestUrl,
  sanitizePrivateStorageText,
} from "./storage-log-sanitizer.ts";

const MAX_ERROR_NESTING_DEPTH = 8;

type ErrorSerializationContext = {
  seen: WeakSet<Error>;
  depth: number;
  privateObjectDir?: string;
};

function errorType(error: Error): string {
  return error.constructor?.name || error.name || "Error";
}

function serializeError(
  error: unknown,
  context: ErrorSerializationContext = {
    seen: new WeakSet<Error>(),
    depth: 0,
    privateObjectDir: process.env.PRIVATE_OBJECT_DIR,
  },
): unknown {
  if (!(error instanceof Error)) {
    return {
      type: "NonError",
      message: sanitizePrivateStorageText(
        String(error),
        context.privateObjectDir,
      ),
    };
  }

  if (context.seen.has(error)) {
    return {
      type: "RepeatedErrorReference",
      message: "Повторная ссылка на уже записанную ошибку опущена",
    };
  }
  if (context.depth >= MAX_ERROR_NESTING_DEPTH) {
    return {
      type: "ErrorDepthLimit",
      message: "Более глубокая цепочка ошибок опущена",
    };
  }
  context.seen.add(error);

  const serialized: Record<string, unknown> = {
    type: errorType(error),
    message: sanitizePrivateStorageText(
      error.message,
      context.privateObjectDir,
    ),
    stack:
      error.stack === undefined
        ? undefined
        : sanitizePrivateStorageText(error.stack, context.privateObjectDir),
  };
  const nestedContext = {
    seen: context.seen,
    depth: context.depth + 1,
    privateObjectDir: context.privateObjectDir,
  };
  if (error.cause !== undefined) {
    serialized.cause = serializeError(error.cause, nestedContext);
  }
  if ("statusWriteError" in error) {
    serialized.statusWriteError = serializeError(
      error.statusWriteError,
      nestedContext,
    );
  }
  return serialized;
}

export function createLoggerOptions(
  environment: NodeJS.ProcessEnv = process.env,
): LoggerOptions {
  const isProduction = environment.NODE_ENV === "production";
  const errorSerializer = (error: unknown) =>
    serializeError(error, {
      seen: new WeakSet<Error>(),
      depth: 0,
      privateObjectDir: environment.PRIVATE_OBJECT_DIR,
    });
  return {
    level: environment.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
    ],
    serializers: { err: errorSerializer },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true },
          },
        }),
  };
}

export function createLogger(
  environment: NodeJS.ProcessEnv = process.env,
  destination?: DestinationStream,
) {
  return pino(createLoggerOptions(environment), destination);
}

export function serializeHttpRequestForLog(req: {
  id?: unknown;
  method?: string;
  url?: string;
}) {
  return {
    id: req.id,
    method: req.method,
    url: sanitizePrivateStorageRequestUrl(req.url),
  };
}

export const logger = createLogger();
