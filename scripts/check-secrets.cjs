const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("@next/env").loadEnvConfig(path.resolve("apps/web"));
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const secrets = [
  process.env.OPENAI_API_KEY,
  process.env.TOSS_SECRET_KEY,
  process.env.BILLING_ENCRYPTION_KEY,
  process.env.CRON_SECRET,
  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n")
    .split("\n")
    .find((line) => line.startsWith("MII")),
].filter((value) => value && value.length > 15);
const failures = [],
  checked = new Set();
function check(file) {
  if (checked.has(file) || !fs.existsSync(file)) return;
  checked.add(file);
  if (!fs.statSync(file).isFile()) return;
  const contents = fs.readFileSync(file);
  if (
    secrets.some((secret) => contents.includes(Buffer.from(secret))) ||
    /(?:^|\/)\.env(?!\.example$)/.test(file.replaceAll("\\", "/"))
  )
    failures.push(file);
}
files.forEach(check);
function bundles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) bundles(file);
    else if (entry.name.endsWith(".js")) check(file);
  }
}
bundles("apps/web/.next/static");
if (failures.length) {
  console.error("Sensitive material found in:", failures);
  process.exitCode = 1;
} else
  console.log(
    `Checked ${checked.size} source/assets and browser bundles; no configured private keys found.`,
  );
