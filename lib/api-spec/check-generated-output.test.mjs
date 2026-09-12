import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import "./check-release-command.test.mjs";

const checkerPath = fileURLToPath(
  new URL("./check-generated-output.mjs", import.meta.url),
);

async function createFixture(mode) {
  const root = await mkdtemp(path.join(tmpdir(), "generated-output-check-"));
  const generated = path.join(root, "generated");
  const script = path.join(root, "fake-codegen.mjs");
  const typecheckScript = path.join(root, "fake-typecheck.mjs");
  await mkdir(generated);
  await writeFile(path.join(generated, "stable.ts"), "stable\n");
  await writeFile(
    script,
    `
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = ${JSON.stringify(root)};
const mode = ${JSON.stringify(mode)};
const statePath = path.join(root, "run-count");
let run = 0;
try {
  run = Number(await readFile(statePath, "utf8"));
} catch {}
run += 1;
await writeFile(statePath, String(run));

const generated = path.join(root, "generated");
await writeFile(path.join(generated, "stable.ts"), "stable\\n");

if (mode === "changed") {
  await writeFile(path.join(generated, "changed.ts"), run === 1 ? "first\\n" : "second\\n");
}
if (mode === "added" && run >= 2) {
  const nested = path.join(generated, "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, "added.ts"), "added\\n");
}
if (mode === "removed") {
  const nested = path.join(generated, "nested");
  const removedPath = path.join(nested, "removed.ts");
  if (run === 1) {
    await mkdir(nested, { recursive: true });
    await writeFile(removedPath, "removed\\n");
  }
  else await rm(removedPath, { force: true });
}
`,
  );
  await writeFile(
    typecheckScript,
    `
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const countPath = path.join(${JSON.stringify(root)}, "typecheck-count");
let count = 0;
try {
  count = Number(await readFile(countPath, "utf8"));
} catch {}
await writeFile(countPath, String(count + 1));
`,
  );
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "fixture@example.test"],
    ["config", "user.name", "Generated output fixture"],
    ["add", "generated"],
    ["commit", "--quiet", "-m", "fixture baseline"],
  ]) {
    const git = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
  }
  return { root, script, typecheckScript };
}

function runChecker({ root, script, typecheckScript }) {
  return spawnSync(process.execPath, [checkerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      GENERATED_OUTPUT_CHECK_ROOT: root,
      GENERATED_OUTPUT_CHECK_PATHS: JSON.stringify(["generated"]),
      GENERATED_OUTPUT_CHECK_COMMAND: JSON.stringify([
        process.execPath,
        script,
      ]),
      GENERATED_OUTPUT_TYPECHECK_COMMAND: JSON.stringify([
        process.execPath,
        typecheckScript,
      ]),
    },
  });
}

async function withFixture(mode, assertion) {
  const fixture = await createFixture(mode);
  try {
    await assertion(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

for (const scenario of [
  { mode: "changed", line: "changed: generated/changed.ts" },
  { mode: "added", line: "added: generated/nested/added.ts" },
  { mode: "removed", line: "removed: generated/nested/removed.ts" },
]) {
  test(`обнаруживает ${scenario.mode} generated file`, async () => {
    await withFixture(scenario.mode, async (fixture) => {
      const result = runChecker(fixture);
      assert.notEqual(result.status, 0);
      assert.ok(
        result.stderr.split(/\r?\n/).includes(scenario.line),
        `stderr должен содержать точную строку "${scenario.line}":\n${result.stderr}`,
      );
    });
  });
}

test("два стабильных запуска checker завершаются успешно", async () => {
  await withFixture("stable", async (fixture) => {
    const first = runChecker(fixture);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(
      await readFile(path.join(fixture.root, "run-count"), "utf8"),
      "2",
    );
    assert.equal(
      await readFile(path.join(fixture.root, "typecheck-count"), "utf8"),
      "1",
    );
    assert.match(
      first.stdout,
      /API codegen is byte-for-byte idempotent \(1 generated files\)\./,
    );

    const second = runChecker(fixture);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(
      await readFile(path.join(fixture.root, "run-count"), "utf8"),
      "4",
    );
    assert.equal(
      await readFile(path.join(fixture.root, "typecheck-count"), "utf8"),
      "2",
    );
    assert.match(
      second.stdout,
      /API codegen is byte-for-byte idempotent \(1 generated files\)\./,
    );
  });
});