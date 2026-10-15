import { randomBytes } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";

const directory = new URL("../.deployment/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await readdir(directory)).length) {
  throw new Error(".deployment already contains files. Existing credentials were not changed.");
}

function base32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let accumulator = 0;
  let bits = 0;
  let result = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(accumulator << (5 - bits)) & 31];
  return result;
}

const randomSecret = () => randomBytes(32).toString("hex");
const serviceToken = randomSecret();
const groomTotpSecret = base32(randomBytes(32));
const brideTotpSecret = base32(randomBytes(32));

function authenticatorInstructions(side, secret) {
  const account = `${side} Coordinator`;
  return [
    "Add a new account in Google Authenticator, 1Password, Authy, or another TOTP app.",
    `Account name: Shaadi Companion ${account}`,
    `Setup key: ${secret}`,
    "Type: Time based; SHA1; 6 digits; period 30 seconds.",
    "Keep this file private. It can be used to enroll or restore this team's authenticator.",
    "",
    `otpauth://totp/Shaadi%20Companion:${encodeURIComponent(account)}?secret=${secret}&issuer=Shaadi%20Companion&algorithm=SHA1&digits=6&period=30`
  ];
}
const credentials = {
  "api.env": [
    "# API project only. Replace the two blank values before deploying.",
    "PUBLIC_APP_ORIGIN=",
    "DATABASE_URL=",
    `DATABASE_INVITATION_TOKEN_PEPPER=${randomSecret()}`,
    `DATABASE_ENTRY_PASS_TOKEN_PEPPER=${randomSecret()}`,
    `BACKEND_SERVICE_TOKEN=${serviceToken}`
  ],
  "web.env": [
    "# Frontend project only. Replace the two blank values before deploying.",
    "PUBLIC_APP_ORIGIN=",
    "BACKEND_URL=",
    `BACKEND_SERVICE_TOKEN=${serviceToken}`,
    `COORDINATOR_GROOM_PASSWORD=${randomSecret()}`,
    `COORDINATOR_BRIDE_PASSWORD=${randomSecret()}`,
    `COORDINATOR_SESSION_SECRET=${randomSecret()}`,
    `COORDINATOR_GROOM_TOTP_SECRET=${groomTotpSecret}`,
    `COORDINATOR_BRIDE_TOTP_SECRET=${brideTotpSecret}`
  ],
  "neon-setup.env": [
    "# Operator-only. Paste Neon's DIRECT owner URL with sslmode=verify-full.",
    "# Never upload this file or DATABASE_SCHEMA_URL to Vercel.",
    "DATABASE_SCHEMA_URL=",
    "DATABASE_SCHEMA_APPLY_TARGET=production",
    "DATABASE_SCHEMA_APPLY_CONFIRMATION=apply-production-schema",
    "DATABASE_RUNTIME_ROLE=shaadi_app",
    `DATABASE_RUNTIME_PASSWORD=${randomSecret()}`
  ],
  "authenticator-groom.txt": authenticatorInstructions("Groom", groomTotpSecret),
  "authenticator-bride.txt": authenticatorInstructions("Bride", brideTotpSecret)
};

for (const [name, lines] of Object.entries(credentials)) {
  await writeFile(new URL(name, directory), `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
}
process.stdout.write("Created private deployment files in .deployment/. No credentials were printed.\n");
process.stdout.write("Fill the blank URLs, then follow docs/vercel-neon-deployment.md.\n");
