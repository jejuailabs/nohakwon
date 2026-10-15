const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (!process.argv.includes("--live")) {
  console.error(
    "Use --live for disposable learning fixtures; --with-ai also runs source-based AI generation.",
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
      "scripts/verify-adaptive-learning.ts",
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
