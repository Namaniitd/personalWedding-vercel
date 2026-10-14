import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { configureLocalImage, readCaCertificate } from "./prepare-local-build.mjs";

const image = "localhost/shaadi-node-local-ca:0123456789abcdef";
let fixtureDirectory;
let caPem;
let leafPem;
let certificate;

before(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "shaadi-local-ca-test-"));
  for (const [name, authority] of [["ca", "TRUE"], ["leaf", "FALSE"]]) {
    const result = spawnSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-nodes", "-days", "2", "-subj", `/CN=Shaadi disposable ${name} test`,
      "-addext", `basicConstraints=critical,CA:${authority}`,
      "-keyout", join(fixtureDirectory, `${name}.key`),
      "-out", join(fixtureDirectory, `${name}.pem`),
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, `OpenSSL must generate the disposable ${name} fixture: ${result.error?.message ?? result.stderr}`);
  }
  caPem = readFileSync(join(fixtureDirectory, "ca.pem"), "utf8");
  leafPem = readFileSync(join(fixtureDirectory, "leaf.pem"), "utf8");
  certificate = new X509Certificate(caPem);
});

after(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
});

test("appending the local image preserves every existing secret and comment byte", () => {
  const existing = "# Local credentials\nPOSTGRES_PASSWORD=synthetic-value\nBACKEND_SERVICE_TOKEN='literal $() and # text'\nCOORDINATOR_PASSWORD=synthetic-password";
  assert.equal(configureLocalImage(existing, image), `${existing}\nLOCAL_NODE_IMAGE=${image}\n`);
  assert.equal(configureLocalImage("", image), `LOCAL_NODE_IMAGE=${image}\n`);
});

test("replacing the image preserves CRLF, surrounding settings, and final newline", () => {
  const existing = "# Local image\r\nLOCAL_NODE_IMAGE=old-image\r\nCOORDINATOR_PASSWORD=synthetic-password\r\n";
  const expected = `# Local image\r\nLOCAL_NODE_IMAGE=${image}\r\nCOORDINATOR_PASSWORD=synthetic-password\r\n`;
  assert.equal(configureLocalImage(existing, image), expected);
  assert.equal(configureLocalImage(expected, image), expected);
  assert.equal(configureLocalImage("POSTGRES_PASSWORD=synthetic\r\n", image), `POSTGRES_PASSWORD=synthetic\r\nLOCAL_NODE_IMAGE=${image}\r\n`);
});

test("dotenv whitespace and export assignments do not leave conflicting local images", () => {
  for (const assignment of [" LOCAL_NODE_IMAGE = old-image", "export LOCAL_NODE_IMAGE=old-image", "\tLOCAL_NODE_IMAGE\t=old-image"]) {
    const existing = `POSTGRES_PASSWORD=synthetic\n${assignment}\n`;
    const updated = configureLocalImage(existing, image);
    assert.equal(updated.match(/LOCAL_NODE_IMAGE/g)?.length, 1, "replace the existing assignment instead of appending another one");
    assert.ok(updated.includes(image));
    assert.ok(updated.startsWith("POSTGRES_PASSWORD=synthetic\n"));
  }
});

test("duplicate local image assignments are rejected before overwriting configuration", () => {
  for (const duplicate of ["LOCAL_NODE_IMAGE=second", "export LOCAL_NODE_IMAGE=second", " LOCAL_NODE_IMAGE = second"]) {
    assert.throws(() => configureLocalImage(`LOCAL_NODE_IMAGE=first\n${duplicate}\n`, image), /duplicate LOCAL_NODE_IMAGE/);
  }
  assert.equal(configureLocalImage("# LOCAL_NODE_IMAGE=commented\n", image), `# LOCAL_NODE_IMAGE=commented\nLOCAL_NODE_IMAGE=${image}\n`);
});

test("only fingerprinted local image tags can enter the env file", () => {
  for (const invalid of [
    "docker.io/library/node:22-alpine", "localhost/shaadi-node-local-ca:latest",
    "localhost/shaadi-node-local-ca:0123456789ABCDEf", `${image}\nCOORDINATOR_PASSWORD=changed`,
    "localhost/shaadi-node-local-ca:0123456789abcde", "localhost/shaadi-node-local-ca:0123456789abcdef0",
  ]) assert.throws(() => configureLocalImage("POSTGRES_PASSWORD=synthetic\n", invalid), /Invalid local build image/);
});

test("a single valid public CA certificate is accepted without changing its identity", () => {
  const accepted = readCaCertificate(`\n${caPem}\n`);
  assert.equal(accepted.ca, true);
  assert.equal(accepted.fingerprint256, certificate.fingerprint256);
});

test("certificate validity boundaries reject future and expired trust anchors", () => {
  const start = new Date(certificate.validFrom).getTime();
  const end = new Date(certificate.validTo).getTime();
  assert.throws(() => readCaCertificate(caPem, new Date(start - 1)), /not currently valid/);
  assert.doesNotThrow(() => readCaCertificate(caPem, new Date(start)));
  assert.doesNotThrow(() => readCaCertificate(caPem, new Date(end - 1)));
  assert.throws(() => readCaCertificate(caPem, new Date(end)), /not currently valid/);
});

test("a valid leaf certificate cannot become a trust anchor", () => {
  assert.throws(() => readCaCertificate(leafPem), /not a certificate authority/);
});

test("certificate bundles and malformed PEM are rejected", () => {
  for (const invalid of ["", "plain text", `${caPem}${caPem}`, "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----\n"]) {
    assert.throws(() => readCaCertificate(invalid));
  }
});

test("private keys and trailing PEM data cannot be copied into the build image", () => {
  const privateKey = readFileSync(join(fixtureDirectory, "ca.key"), "utf8");
  for (const invalid of [
    privateKey, `${caPem}${privateKey}`, `${caPem}${privateKey}-----END CERTIFICATE-----\n`,
    `${caPem}unexpected trailing text\n-----END CERTIFICATE-----\n`,
  ]) assert.throws(() => readCaCertificate(invalid), /public CA certificate in PEM format/);
});
