import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generatedPaths = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];
const repositoryRoot =
  process.env.GENERATED_OUTPUT_CHECK_ROOT ??
  fileURLToPath(new URL("../..", import.meta.url));
const configuredGeneratedPaths = process.env.GENERATED_OUTPUT_CHECK_PATHS
  ? JSON.parse(process.env.GENERATED_OUTPUT_CHECK_PATHS)
  : generatedPaths;
const codegenCommand = process.env.GENERATED_OUTPUT_CHECK_COMMAND
  ? JSON.parse(process.env.GENERATED_OUTPUT_CHECK_COMMAND)
  : ["pnpm", "run", "codegen:generate"];
const typecheckCommand = process.env.GENERATED_OUTPUT_TYPECHECK_COMMAND
  ? JSON.parse(process.env.GENERATED_OUTPUT_TYPECHECK_COMMAND)
  : ["pnpm", "-w", "run", "typecheck:libs"];

function runCommand(configuredCommand) {
  const [command, ...args] = configuredCommand;
  const result = spawnSync(command, args, {
    cwd: import.meta.dirname,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function listFiles(relativeDirectory) {
  const entries = await readdir(path.join(repositoryRoot, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function createHashManifest() {
  const files = (
    await Promise.all(
      configuredGeneratedPaths.map((directory) => listFiles(directory)),
    )
  )
    .flat()
    .sort();
  const manifest = new Map();
  for (const file of files) {
    const contents = await readFile(path.join(repositoryRoot, file));
    manifest.set(file, createHash("sha256").update(contents).digest("hex"));
  }
  return manifest;
}

function compareHashManifests(first, second) {
  const files = new Set([...first.keys(), ...second.keys()]);
  return [...files]
    .sort()
    .flatMap((file) => {
      if (!first.has(file)) return [{ status: "added", file }];
      if (!second.has(file)) return [{ status: "removed", file }];
      if (first.get(file) !== second.get(file)) {
        return [{ status: "changed", file }];
      }
      return [];
    });
}

runCommand(codegenCommand);
const firstManifest = await createHashManifest();
runCommand(codegenCommand);
const secondManifest = await createHashManifest();
const nonIdempotentFiles = compareHashManifests(firstManifest, secondManifest);

if (nonIdempotentFiles.length > 0) {
  console.error(
    "API codegen is not byte-for-byte idempotent across two consecutive runs.",
  );
  for (const { status, file } of nonIdempotentFiles) {
    console.error(`${status}: ${file}`);
  }
  process.exit(1);
}

runCommand(typecheckCommand);

console.log(
  `API codegen is byte-for-byte idempotent (${secondManifest.size} generated files).`,
);

const status = spawnSync(
  "git",
  [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...configuredGeneratedPaths,
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
  },
);
if (status.error) throw status.error;
if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(status.status ?? 1);
}

const drift = status.stdout.trim();
if (drift) {
  console.error(
    "Generated API clients are out of sync with lib/api-spec/openapi.yaml.",
  );
  console.error(drift);
  console.error(
    "Run `pnpm --filter @workspace/api-spec run codegen` and commit the generated files.",
  );
  process.exit(1);
}

console.log("Generated API clients are up to date.");