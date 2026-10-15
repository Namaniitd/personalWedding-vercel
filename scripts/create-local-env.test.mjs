import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseEnv } from "node:util";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "shaadi-local-env-"));
  await mkdir(join(root, "scripts"));
  const script = join(root, "scripts", "create-local-env.mjs");
  await copyFile(new URL("./create-local-env.mjs", import.meta.url), script);
  return { root, script };
}

test("a fresh local stack has private, independent secrets for both coordinator teams", async () => {
  const { root, script } = await fixture();
  try {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(result.status, 0);
    const values = parseEnv(await readFile(join(root, ".env"), "utf8"));
    const secrets = Object.values(values);
    assert.ok(values.COORDINATOR_GROOM_PASSWORD);
    assert.ok(values.COORDINATOR_BRIDE_PASSWORD);
    assert.notEqual(values.COORDINATOR_GROOM_PASSWORD, values.COORDINATOR_BRIDE_PASSWORD);
    assert.equal(new Set(secrets).size, secrets.length);
    for (const secret of secrets) {
      assert.match(secret, /^[0-9a-f]{64}$/);
      assert.ok(!result.stdout.includes(secret));
      assert.ok(!result.stderr.includes(secret));
    }
    if (process.platform !== "win32") assert.equal((await stat(join(root, ".env"))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing local env keeps credentials, peppers, formatting and file mode unchanged", async () => {
  const { root, script } = await fixture();
  try {
    const existing = "# Existing synthetic deployment\r\nCOORDINATOR_PASSWORD=existing-groom-secret\r\nDATABASE_INVITATION_TOKEN_PEPPER='literal # and $() text'\r\nPOSTGRES_PASSWORD=existing-database-secret";
    const destination = join(root, ".env");
    await writeFile(destination, existing, { mode: 0o600 });
    const before = await stat(destination);
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(destination, "utf8"), existing);
    assert.equal((await stat(destination)).mode, before.mode);
    assert.ok(!result.stdout.includes("existing-groom-secret"));
    assert.ok(!result.stderr.includes("existing-groom-secret"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
