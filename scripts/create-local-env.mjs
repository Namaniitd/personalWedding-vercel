import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const keys = [
  "POSTGRES_PASSWORD",
  "DATABASE_INVITATION_TOKEN_PEPPER",
  "DATABASE_ENTRY_PASS_TOKEN_PEPPER",
  "BACKEND_SERVICE_TOKEN",
  "COORDINATOR_SESSION_SECRET",
  "COORDINATOR_GROOM_PASSWORD",
  "COORDINATOR_BRIDE_PASSWORD"
];

try {
  const body = `${keys.map((key) => `${key}=${randomBytes(32).toString("hex")}`).join("\n")}\n`;
  writeFileSync(new URL("../.env", import.meta.url), body, { flag: "wx", mode: 0o600 });
  process.stdout.write("Created private root .env with independent local secrets and separate coordinator passwords.\n");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    process.stderr.write("Root .env already exists; it was not changed.\n");
    process.exitCode = 1;
  } else {
    throw error;
  }
}
