import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("deployment credentials stay separated, private, and unchanged on rerun", async () => {
  const root = await mkdtemp(join(tmpdir(), "shaadi-deployment-"));
  try {
    await mkdir(join(root, "scripts"));
    const script = join(root, "scripts", "create-deployment-env.mjs");
    await copyFile(new URL("./create-deployment-env.mjs", import.meta.url), script);
    const first = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(first.status, 0);
    const apiText = await readFile(join(root, ".deployment", "api.env"), "utf8");
    const webText = await readFile(join(root, ".deployment", "web.env"), "utf8");
    const parse = (text) => Object.fromEntries(text.split("\n").filter((line) => line && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    const api = parse(apiText);
    const web = parse(webText);
    assert.equal(api.BACKEND_SERVICE_TOKEN, web.BACKEND_SERVICE_TOKEN);
    assert.match(web.COORDINATOR_TOTP_SECRET, /^[A-Z2-7]{52}$/);
    assert.equal(web.DATABASE_URL, undefined);
    assert.equal(web.DATABASE_INVITATION_TOKEN_PEPPER, undefined);
    assert.equal(api.COORDINATOR_PASSWORD, undefined);
    const secrets = [api.BACKEND_SERVICE_TOKEN, api.DATABASE_INVITATION_TOKEN_PEPPER,
      api.DATABASE_ENTRY_PASS_TOKEN_PEPPER, web.COORDINATOR_PASSWORD, web.COORDINATOR_SESSION_SECRET];
    assert.equal(new Set(secrets).size, secrets.length);
    for (const secret of secrets) {
      assert.match(secret, /^[0-9a-f]{64}$/);
      assert.ok(!first.stdout.includes(secret));
    }
    if (process.platform !== "win32") {
      assert.equal((await stat(join(root, ".deployment", "api.env"))).mode & 0o777, 0o600);
      assert.equal((await stat(join(root, ".deployment"))).mode & 0o777, 0o700);
    }
    const second = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.notEqual(second.status, 0);
    assert.equal(await readFile(join(root, ".deployment", "api.env"), "utf8"), apiText);
    assert.equal(await readFile(join(root, ".deployment", "web.env"), "utf8"), webText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
