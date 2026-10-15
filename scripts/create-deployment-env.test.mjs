import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
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
    assert.match(web.COORDINATOR_GROOM_TOTP_SECRET, /^[A-Z2-7]{52}$/);
    assert.match(web.COORDINATOR_BRIDE_TOTP_SECRET, /^[A-Z2-7]{52}$/);
    assert.notEqual(web.COORDINATOR_GROOM_TOTP_SECRET, web.COORDINATOR_BRIDE_TOTP_SECRET);
    assert.equal(web.DATABASE_URL, undefined);
    assert.equal(web.DATABASE_INVITATION_TOKEN_PEPPER, undefined);
    assert.equal(api.COORDINATOR_PASSWORD, undefined);
    assert.equal(api.COORDINATOR_GROOM_PASSWORD, undefined);
    assert.equal(api.COORDINATOR_BRIDE_PASSWORD, undefined);
    assert.equal(api.COORDINATOR_GROOM_TOTP_SECRET, undefined);
    assert.equal(api.COORDINATOR_BRIDE_TOTP_SECRET, undefined);
    const secrets = [api.BACKEND_SERVICE_TOKEN, api.DATABASE_INVITATION_TOKEN_PEPPER,
      api.DATABASE_ENTRY_PASS_TOKEN_PEPPER, web.COORDINATOR_GROOM_PASSWORD,
      web.COORDINATOR_BRIDE_PASSWORD, web.COORDINATOR_SESSION_SECRET];
    assert.equal(new Set(secrets).size, secrets.length);
    for (const secret of secrets) {
      assert.match(secret, /^[0-9a-f]{64}$/);
      assert.ok(!first.stdout.includes(secret));
      assert.ok(!first.stderr.includes(secret));
    }
    for (const side of ["groom", "bride"]) {
      const secret = web[`COORDINATOR_${side.toUpperCase()}_TOTP_SECRET`];
      const other = web[`COORDINATOR_${side === "groom" ? "BRIDE" : "GROOM"}_TOTP_SECRET`];
      const instructions = await readFile(join(root, ".deployment", `authenticator-${side}.txt`), "utf8");
      const uri = new URL(instructions.split("\n").find((line) => line.startsWith("otpauth://")));
      assert.equal(uri.searchParams.get("secret"), secret);
      assert.equal(uri.searchParams.get("algorithm"), "SHA1");
      assert.equal(uri.searchParams.get("digits"), "6");
      assert.equal(uri.searchParams.get("period"), "30");
      assert.ok(instructions.includes(`Setup key: ${secret}`));
      assert.ok(!instructions.includes(other));
      assert.ok(!first.stdout.includes(secret));
      assert.ok(!first.stderr.includes(secret));
    }
    const before = new Map();
    for (const name of await readdir(join(root, ".deployment"))) {
      before.set(name, await readFile(join(root, ".deployment", name), "utf8"));
    }
    if (process.platform !== "win32") {
      for (const name of before.keys()) assert.equal((await stat(join(root, ".deployment", name))).mode & 0o777, 0o600);
      assert.equal((await stat(join(root, ".deployment"))).mode & 0o777, 0o700);
    }
    const second = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.notEqual(second.status, 0);
    assert.equal(await readFile(join(root, ".deployment", "api.env"), "utf8"), apiText);
    assert.equal(await readFile(join(root, ".deployment", "web.env"), "utf8"), webText);
    for (const [name, contents] of before) assert.equal(await readFile(join(root, ".deployment", name), "utf8"), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
