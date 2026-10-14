// Explicit opt-in: disposable Firestore fixtures; --learning-only skips paid AI.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (!process.argv.includes("--live")) {
  console.error(
    "Run with --live to use the configured Firebase project and OpenAI API with synthetic fixtures.",
  );
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/web/tsconfig.json",
      "scripts/verify-integrations.ts",
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS || ""} --conditions=react-server`.trim(),
      },
    },
  );
  process.exitCode = result.status ?? 1;
}
