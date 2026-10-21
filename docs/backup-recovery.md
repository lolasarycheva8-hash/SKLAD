# Independent encrypted warehouse backup / restore runbook

## Status and authorization

The CLI is implemented; **no cloud backup, production restore, schedule, or active monitoring is claimed**. No production dump/restore was executed during implementation. The Yandex bucket, scoped S3 access credentials, encryption key, and isolated PostgreSQL restore host still require operator provisioning. Generic Yandex OAuth is not an S3 credential.

Do not repurpose the existing autoscale API service as a scheduled deployment. Create a separate scheduled job, with this repository/build and explicit production secrets, only after approval. Do not run a production backup from the workspace's development database. Production identification requires both `NODE_ENV=production` and `BACKUP_SOURCE_ENVIRONMENT=production`; these assertions are not proof that a URL points to production. An operator must independently match host/database against the production deployment's database configuration before injecting `DATABASE_URL`.

## Build and commands

From repository root (Node 24, pnpm, matching supported PostgreSQL client tools):

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run test:backup
```

Standalone entrypoint (does not start Express or web timers):

```sh
node artifacts/api-server/dist/backup.cjs create
node artifacts/api-server/dist/backup.cjs schedule
node artifacts/api-server/dist/backup.cjs health
node artifacts/api-server/dist/backup.cjs verify-restore
```

Equivalent package command: `pnpm --filter @workspace/api-server backup health`.

Configure secrets in the job's secret manager, never in source, CLI arguments, shell history, or log output:

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` for production, `development` for development |
| `BACKUP_SOURCE_ENVIRONMENT` | Explicit `production` or `development`; must match runtime |
| `BACKUP_SOURCE_ID` | Stable unique project slug, 3–64 lowercase letters/digits/underscore/hyphen, never reused by another warehouse |
| `DATABASE_URL` | Verified production PostgreSQL connection URL for production job |
| `BACKUP_S3_ENDPOINT` | Default `https://storage.yandexcloud.net`; other providers/endpoints rejected |
| `BACKUP_S3_REGION` | Default `ru-central1` |
| `BACKUP_S3_BUCKET` | Independently owned external Yandex S3 bucket, never App Storage |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Scoped S3 service account credentials |
| `BACKUP_ENCRYPTION_KEY` | Canonical base64 encoding of 32 cryptographically random bytes |
| `PRIVATE_OBJECT_DIR` | Same production App Storage source directory used by the app |
| `BACKUP_ALERT_WEBHOOK_URL` | Optional HTTPS public endpoint receiving only generic failure status |
| `BACKUP_DEADLINE_MINUTES` | Overall CLI deadline, default 30 minutes, allowed 1–90 |

Source App Storage reads currently use the existing Replit sidecar authentication. Run acquisition on a dedicated Replit scheduled deployment with production App Storage access, not an arbitrary off-platform cron host without that capability. The independent backup destination and drill do not depend on App Storage retaining original objects.

Generate the encryption key on a trusted operator machine: `openssl rand -base64 32`. Place it directly in secrets and **escrow an independent offline copy** in an access-controlled password manager or vault, separate from Replit and Yandex. Losing the key makes recovery impossible. Preserve old keys through retention when rotating; this initial implementation selects one key and fails closed if existing manifests cannot authenticate. Plan prefix/bucket migration for rotation rather than silently ignoring older-key objects.

Use bucket versioning / Object Lock where available. Application IAM should allow list/get/head/put and multipart upload/abort for `warehouse/<BACKUP_SOURCE_ID>/production/` (separate development credentials/prefix recommended), but **no DeleteObject**. Source ID and environment are authenticated inside every start/manifest/completion marker as well as in their encrypted namespace. Health and scheduling reject manifests whose host/normalized port/database no longer match the configured current source. Do not point two projects at one source ID. Uploads use unique run IDs, immutable encrypted manifest/marker writes, and no external deletion code. Limit restore credentials to an isolated cluster.

## PostgreSQL tooling and permissions

Install `pg_dump` and `pg_restore` on the scheduled job image and drill runner. Verify `pg_dump --version`, `pg_restore --version`, and server version before activation. Use the same PostgreSQL major client tools as the source server, and an isolated restore server on that major version. Older `pg_dump` cannot dump newer servers. Required extensions must also be installed on the isolated server. No tools were installed or real servers probed by this implementation.

Source role must read all included tables/sequences, use exported snapshots, and must not be restricted by RLS in a way that silently omits rows. Do not add `--enable-row-security`. `pg_dump` fails instead of making an incomplete RLS dump. All ordinary non-system tables are counted. TLS URL options supported by both the CLI subprocess adapter and libpq: `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `channel_binding`. Unsupported URL query parameters fail closed. Use CA verification in production. URLs/passwords are not passed as process arguments; restricted child environment uses PG connection variables. Protect the runner user/process environment from other local users.

The source database connection has a three-connection pool: scheduler lease, exclusive deletion barrier, exported snapshot. File deletion is blocked while references/dump/files are acquired. Size scratch disk for the dump plus its encrypted copy and one object at a time. The snapshot transaction stays open until all acquisition is done. No production schema changes occur.

Boundaries: overall command defaults to 30 minutes (maximum configurable 90); pg tools 25 minutes; PostgreSQL connect 30 seconds; queries/server statements 120 seconds; S3 connect 15 seconds and request/download 120 seconds; each multipart upload 10 minutes; source/encryption/decryption streams 120 seconds per item. SDK retries are capped at three attempts. SIGTERM/SIGINT/deadline abort streams/children and allow 30 seconds for cleanup before forced nonzero exit. OS process termination closes PostgreSQL sockets and releases session locks even when graceful cleanup stalls. A hard stop can leave restricted scratch or an owned isolated drill database, never an approved completion marker for unverified data.

## Scheduling and independent health

Recommended external schedule, UTC:

```cron
# Dedicated production job, secrets injected by the scheduler:
0 * * * * cd /app && node artifacts/api-server/dist/backup.cjs schedule
# Separate monitor/job, not dependent on successful backup execution:
10,25,40,55 * * * * cd /app && node artifacts/api-server/dist/backup.cjs health
```

These are recommendations, **not installed schedules**. Configure job timeout slightly above the CLI deadline to allow cleanup, retry failure, and external alerts on nonzero/missed executions. `schedule` is idempotent when the latest complete snapshot is under 23 hours old; after that it creates a new unique run. A terminal authenticated `INCOMPLETE/MISSING_REFERENCES` snapshot is also captured at most once per 23-hour window: intervening runs skip duplicate salvage but **exit nonzero and alert**, never claim health. Manual `create` bypasses this gate after repair. Transient/interrupted `ACQUISITION_FAILED` attempts retry once per hourly invocation, bounded by the CLI deadline, not in an unbounded in-process loop; this can retain up to 24 partial attempts/day during persistent transient failure, so monitor storage growth. A PostgreSQL advisory lease prevents concurrent creates. Overlapping invocation exits nonzero rather than claiming success. Daily-at-a-fixed-time alone has no retry margin; hourly due checks provide retries.

Health authenticates completion marker and encrypted manifest, **downloads every referenced dump/file and verifies GCM, plaintext SHA-256 and length**, and measures age from **snapshot transaction start**, never upload completion. Creation performs the same downloaded-payload verification before writing its completion marker. Maximum healthy age is 24 hours, checked again after integrity verification. A newer incomplete/running attempt makes health fail even if an older backup exists. A crash after writing the start record remains unhealthy until a later complete retry. Full integrity checks cost one complete backup download per successful health invocation (four per hour with this example), plus scheduler checks and creation verification; budget Yandex request/egress costs accordingly. Health proves payload integrity, not PostgreSQL semantic restorability; still run isolated drills. Corrupt authentication, missing objects, missing credentials and stale copies all exit nonzero.

Without the webhook, the CLI explicitly reports `NOT CONFIGURED`; exit-code monitoring still must be configured independently. Webhook notifications contain no names, paths, hosts, counts, raw exception messages, or secrets. Only HTTPS port 443/public resolved addresses are accepted, DNS is pinned for the request, and redirects are refused. Delivery failure also exits nonzero. A webhook cannot report if the job never runs: enable scheduler dead-man/missed-run monitoring.

## Completeness, encryption and salvage

Every dump/file/manifest uses AES-256-GCM with independent random 96-bit IV, a 128-bit authentication tag, and destination key as authenticated context. The envelope format is eight bytes `WHBK0001`, 12-byte IV, ciphertext, 16-byte tag. Manifest includes plaintext SHA-256/byte length for each item, snapshot source identity, schema column/constraint/index metadata, all table counts, and sorted delivery-photo ID/path/original name/MIME mapping. Original names and paths are only in encrypted data; S3 file object keys use IDs.

Dump is `pg_dump --format=custom --snapshot ...`. References and counts are read from the same repeatable-read snapshot. A database-wide deletion barrier protects acquisition from participating app deletion paths; operators must prevent out-of-band App Storage lifecycle/deletes during acquisition. Temporary directories are mode 0700 and plaintext/encrypted scratch files 0600; finally blocks remove scratch. Hard machine kills cannot execute finally: use encrypted ephemeral disk and OS-managed cleanup of abandoned `warehouse-backup-*` directories after confirming no process owns them.

**Known missing originals are not exempted.** Current inventory was reported as 655 references with 208 absent; this runbook does not reassert that as a fresh scan. All available objects and dump are salvaged, but any missing/unreadable reference produces encrypted `INCOMPLETE` manifest/missing-ID list and no completion marker. Restore the original documents or resolve their business-record references through an explicitly approved remediation process. Never mark baseline losses acceptable just to make backup green.

The immutable authenticated `complete.enc` marker is written last. An incomplete attempt never advances last success. Interrupted uploads may leave encrypted unreferenced data; do not remove manually until reviewed. Multipart failures attempt abort. Sensitive raw SDK/database errors are not printed. Inspect manifests only with the escrowed key in a restricted operator environment; do not publish decrypted manifests.

## Isolated restore drill

Set these secrets only on the explicitly authorized drill runner:

* `BACKUP_RESTORE_ALLOW_ISOLATED=true`
* `BACKUP_RESTORE_DATABASE_URL`: connection to an isolated administrative database, with a dedicated role allowed to CREATE DATABASE and own/drop its newly created database.

Keep source `DATABASE_URL`, source environment/source ID and S3/key configuration available for identity safety checks. For production manifests the drill must itself run with `NODE_ENV=production` and `BACKUP_SOURCE_ENVIRONMENT=production`; that does not authorize touching production. Restore alone allows an authenticated historical host/database to differ after a migration; it still requires exactly the configured stable source ID/environment. Health and scheduling do not allow historical mismatches. Use a restore host **different from source**, including DNS-resolved IPs, and a differently named administrative database. The configured source and authenticated historical source are both checked. The operator is responsible for verifying cluster isolation (host aliases/proxies can mask the same cluster); network policy should deny the drill role access to production.

After authorization:

```sh
node artifacts/api-server/dist/backup.cjs verify-restore
```

The drill selects the newest complete authenticated copy (never incomplete salvage), authenticates/decrypts and hashes the dump and every object into restricted scratch, and creates a random `warehouse_drill_<uuid>` database using `CREATE DATABASE ... TEMPLATE template0`. Existing databases are never overwritten or dropped. It restores using `pg_restore --no-owner --no-acl --exit-on-error`, compares schema metadata/table set/all table counts/exact sorted file references, and removes only the database successfully created by that invocation. An encrypted `restore-<uuid>.enc` result is written only after full verification and cleanup.

Recovered documents are verified and discarded by the drill; it never overwrites production App Storage. A real disaster recovery promotion needs a separate reviewed procedure for new production database provisioning, re-uploading documents from the deterministic manifest mappings, environment cutover and user acceptance. This CLI deliberately does not authorize that operation.

If the runner is killed or cleanup fails, a random isolated drill database can remain. Investigate using isolated host admin logs; manual cleanup requires verifying ownership/run provenance. Never use broad DROP patterns. Run a successful drill before declaring the backup operational, then at least monthly and after schema/key/tool changes. No real cloud drill was performed during implementation.

## Retention

**Retention deletion is deferred, intentionally.** The CLI never deletes external backups. Recommended policy after a successful independently witnessed restore: retain at least 30 days of complete copies (and review incomplete salvage separately), retain a known-good drill-verified copy, and then configure a reviewed Yandex lifecycle. Do not activate a blanket 30-day expiry while backups remain incomplete or before restore is proven. Consider separate long-term drill-verified retention/versioning; bucket lifecycle is independent of CLI authentication and can otherwise remove the last recoverable copy.