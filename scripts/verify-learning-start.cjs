const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (!process.argv.includes("--live"))
  throw Error("Use --live for disposable catalog learning verification.");
const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    path.resolve("node_modules/tsx/dist/cli.mjs"),
    "--tsconfig",
    "apps/web/tsconfig.json",
    "scripts/verify-learning-start.ts",
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
