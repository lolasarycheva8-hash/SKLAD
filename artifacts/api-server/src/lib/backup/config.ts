import { encryptionKey, validateConnectionUrl } from "./security";
import { BackupFailure } from "./runtime";

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  if (!value) throw new BackupFailure(`Missing ${key}`);
  return value;
}
export function config(env = process.env) {
  const environment = required(env, "BACKUP_SOURCE_ENVIRONMENT");
  if (!["production", "development"].includes(environment)) throw new BackupFailure("Explicit production/development source required");
  if ((environment === "production") !== (env.NODE_ENV === "production")) throw new BackupFailure("NODE_ENV does not match BACKUP_SOURCE_ENVIRONMENT");
  const sourceId = required(env, "BACKUP_SOURCE_ID");
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(sourceId)) throw new BackupFailure("BACKUP_SOURCE_ID must be a stable unique project slug (3..64 characters)");
  const endpoint = new URL(env.BACKUP_S3_ENDPOINT || "https://storage.yandexcloud.net");
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "storage.yandexcloud.net" || endpoint.username || endpoint.password || endpoint.search || endpoint.pathname !== "/") throw new Error("Only independent Yandex S3 HTTPS endpoint is allowed");
  const source = required(env, "DATABASE_URL");
  validateConnectionUrl(source);
  return {
    environment, source, sourceId, key: encryptionKey(required(env, "BACKUP_ENCRYPTION_KEY")),
    prefix: `warehouse/${sourceId}/${environment}/`, endpoint: endpoint.href,
    region: env.BACKUP_S3_REGION || "ru-central1",
    bucket: required(env, "BACKUP_S3_BUCKET"),
    credentials: { accessKeyId: required(env, "BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required(env, "BACKUP_S3_SECRET_ACCESS_KEY") },
  };
}
export type Config = ReturnType<typeof config>;