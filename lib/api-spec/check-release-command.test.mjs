import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// This guard only reads package scripts; it never executes smoke or codegen.
const expectedReleaseValidation =
  "pnpm run check:api-generated && ROLE_SMOKE_ALLOW_DEVELOPMENT_MUTATIONS=1 pnpm --filter @workspace/api-server run test:roles-smoke";

async function readPackages() {
  const [workspace, apiSpec] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("./package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  return { workspace, "@workspace/api-spec": apiSpec };
}

function findPnpmScriptInvocation(command, currentPackageName) {
  const match = command.match(
    /\bpnpm(?:\s+-w)?(?:\s+--filter\s+("[^"]+"|'[^']+'|[^\s]+))?\s+run\s+([^\s;&|]+)/,
  );
  if (!match) return null;

  const filter = match[1]?.replace(/^(['"])|(['"])$/g, "");
  return {
    packageName: command.match(/\bpnpm\s+-w\b/)
      ? "workspace"
      : (filter ?? currentPackageName),
    scriptName: match[2],
  };
}

function countCodegenBeforeRolesSmoke(packages) {
  let codegenCalls = 0;
  const activeScripts = new Set();

  function visit(packageName, scriptName) {
    const key = `${packageName}:${scriptName}`;
    assert.ok(!activeScripts.has(key), `обнаружен цикл package scripts: ${key}`);
    activeScripts.add(key);

    if (/^codegen(?::|$)/.test(scriptName)) codegenCalls += 1;

    const script = packages[packageName]?.scripts?.[scriptName];
    assert.equal(typeof script, "string", `не найден package script ${key}`);

    for (const command of script.split(/\s*&&\s*/)) {
      if (/\brun\s+test:roles-smoke\b/.test(command)) break;
      const invocation = findPnpmScriptInvocation(command, packageName);
      if (invocation) visit(invocation.packageName, invocation.scriptName);
    }

    activeScripts.delete(key);
  }

  visit("workspace", "test:release:roles");
  return codegenCalls;
}

function assertReleaseCommand(packages) {
  assert.equal(
    packages.workspace.scripts?.["test:release:roles"],
    expectedReleaseValidation,
    "test:release:roles должна запускать только check:api-generated перед roles smoke; отдельный codegen вернёт лишнюю генерацию",
  );
  assert.equal(
    countCodegenBeforeRolesSmoke(packages),
    0,
    "release-цепочка до roles smoke не должна отдельно запускать codegen",
  );
}

test("корневая release-проверка не запускает codegen перед idempotency checker", async () => {
  assertReleaseCommand(await readPackages());
});

test("guard отклоняет удаление check:api-generated из release-команды", async () => {
  const packages = await readPackages();
  packages.workspace.scripts["test:release:roles"] =
    expectedReleaseValidation.replace("pnpm run check:api-generated && ", "");
  assert.throws(
    () => assertReleaseCommand(packages),
    { code: "ERR_ASSERTION", message: /должна запускать только check:api-generated/ },
  );
});

test("guard отклоняет дополнительный codegen во вложенных package scripts", async () => {
  const packages = await readPackages();
  for (const [packageName, scriptName, codegenCommand] of [
    [
      "workspace",
      "check:api-generated",
      "pnpm --filter @workspace/api-spec run codegen",
    ],
    ["@workspace/api-spec", "check:generated", "pnpm run codegen"],
  ]) {
    const mutatedPackages = structuredClone(packages);
    mutatedPackages[packageName].scripts[scriptName] += ` && ${codegenCommand}`;
    assert.equal(
      countCodegenBeforeRolesSmoke(mutatedPackages),
      2,
      `лишний codegen и вложенный codegen:generate внутри ${packageName}:${scriptName} должны быть обнаружены`,
    );
    assert.throws(
      () => assertReleaseCommand(mutatedPackages),
      { code: "ERR_ASSERTION", message: /не должна отдельно запускать codegen/ },
    );
  }
});