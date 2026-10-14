import { X509Certificate, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename, lstat, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tls from "node:tls";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imagePrefix = "localhost/shaadi-node-local-ca:";

export function readCaCertificate(pem, now = new Date()) {
  if (!/^\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\r\n\t ]+-----END CERTIFICATE-----\s*$/.test(pem)) {
    throw new Error("Provide one public CA certificate in PEM format.");
  }
  const certificate = new X509Certificate(pem);
  if (!certificate.ca) throw new Error("The supplied certificate is not a certificate authority.");
  if (now < new Date(certificate.validFrom) || now >= new Date(certificate.validTo)) {
    throw new Error("The supplied CA certificate is not currently valid.");
  }
  return certificate;
}

export function configureLocalImage(envText, image) {
  if (!/^localhost\/shaadi-node-local-ca:[a-f0-9]{16}$/.test(image)) throw new Error("Invalid local build image.");
  const assignment = /^[ \t]*(?:export[ \t]+)?LOCAL_NODE_IMAGE[ \t]*=[^\r\n]*/gm;
  const lines = envText.match(assignment) ?? [];
  if (lines.length > 1) throw new Error("Remove duplicate LOCAL_NODE_IMAGE entries before preparing the build.");
  if (lines.length) return envText.replace(assignment, `LOCAL_NODE_IMAGE=${image}`);
  const newline = envText.includes("\r\n") ? "\r\n" : "\n";
  return `${envText}${envText && !envText.endsWith("\n") ? newline : ""}LOCAL_NODE_IMAGE=${image}${newline}`;
}

async function verifyRegistry(pem) {
  await new Promise((resolveVerified, reject) => {
    const socket = tls.connect({ host: "registry.npmjs.org", port: 443, servername: "registry.npmjs.org", ca: pem, rejectUnauthorized: true });
    socket.setTimeout(20_000, () => socket.destroy(new Error("Registry certificate verification timed out.")));
    socket.once("secureConnect", () => { socket.end(); resolveVerified(); });
    socket.once("error", reject);
  });
}

async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} failed with exit code ${code}.`)));
  });
}

export async function prepareLocalBuild(args = process.argv.slice(2)) {
  let caPath = resolve(root, ".local-build/corporate-ca.pem"), caName;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--ca" && args[index + 1]) caPath = resolve(args[++index]);
    else if (args[index] === "--macos-ca-name" && args[index + 1]) caName = args[++index];
    else throw new Error("Usage: node scripts/prepare-local-build.mjs [--ca public-root.pem | --macos-ca-name 'Trusted CA name']");
  }
  const buildDirectory = resolve(root, ".local-build/node-ca");
  await mkdir(buildDirectory, { recursive: true, mode: 0o700 });
  if (caName) {
    if (process.platform !== "darwin") throw new Error("Native trusted-anchor export requires macOS; use --ca on other systems.");
    await run("swift", [resolve(root, "scripts/export-macos-ca.swift"), caName, caPath]);
  }
  const pem = await readFile(caPath, "utf8");
  const certificate = readCaCertificate(pem);
  await verifyRegistry(pem);
  console.log(`Verified npm registry hostname and chain with CA ${certificate.subject}; SHA-256 ${certificate.fingerprint256}.`);

  const baseImage = "docker.io/library/node:22-alpine";
  let baseId;
  try { baseId = (await execute("podman", ["image", "inspect", "--format", "{{.Id}}", baseImage], { timeout: 20_000 })).stdout.trim(); }
  catch (error) {
    if (!/no such image|image.*(?:not found|not known)|failed to find image/i.test(error.stderr ?? "")) throw new Error("Podman could not inspect its images. Check that the Podman machine is running and responding.");
    await run("podman", ["pull", baseImage]);
    baseId = (await execute("podman", ["image", "inspect", "--format", "{{.Id}}", baseImage], { timeout: 20_000 })).stdout.trim();
  }
  const packages = await Promise.all(["api", "web"].map(async (service) => JSON.parse(await readFile(resolve(root, service, "package.json"), "utf8"))));
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(baseId)) throw new Error("Podman returned an invalid base image ID.");
  const manager = packages[0].packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(manager) || packages[1].packageManager !== manager) throw new Error("Both services must pin the same pnpm version.");
  const dockerfile = `FROM ${baseId}\nCOPY ca.pem /usr/local/share/shaadi-local-ca.pem\nRUN chmod 644 /usr/local/share/shaadi-local-ca.pem && cat /usr/local/share/shaadi-local-ca.pem >> /etc/ssl/certs/ca-certificates.crt\nENV NODE_EXTRA_CA_CERTS=/usr/local/share/shaadi-local-ca.pem\nENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt\nENV NPM_CONFIG_CAFILE=/etc/ssl/certs/ca-certificates.crt\nENV npm_config_network_concurrency=2\nENV npm_config_child_concurrency=1\nRUN corepack enable && corepack prepare ${manager} --activate\n`;
  const tag = createHash("sha256").update(certificate.raw).update(baseId).update(dockerfile).digest("hex").slice(0, 16);
  const image = `${imagePrefix}${tag}`;
  await writeFile(resolve(buildDirectory, "ca.pem"), pem, { mode: 0o600 });
  await writeFile(resolve(buildDirectory, "Dockerfile"), dockerfile, { mode: 0o600 });
  await run("podman", ["build", "--jobs=1", "--tag", image, buildDirectory]);
  const imageId = (await execute("podman", ["image", "inspect", "--format", "{{.Id}}", image], { timeout: 20_000 })).stdout.trim();
  await writeFile(resolve(root, ".local-build/manifest.json"), JSON.stringify({ image, imageId, baseImage, baseId, caFingerprint: certificate.fingerprint256, packageManager: manager }, null, 2) + "\n", { mode: 0o600 });

  const envPath = resolve(root, ".env");
  const metadata = await lstat(envPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("The local .env must be a regular file.");
  const existing = await readFile(envPath, "utf8");
  const updated = configureLocalImage(existing, image);
  if (updated !== existing) {
    const temporary = `${envPath}.local-build-${process.pid}.tmp`;
    try { await writeFile(temporary, updated, { mode: 0o600, flag: "wx" }); await rename(temporary, envPath); }
    finally { await rm(temporary, { force: true }); }
  }
  console.log(`Local Compose builds now use ${image}. Existing .env secrets were preserved.`);
  return image;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareLocalBuild().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
