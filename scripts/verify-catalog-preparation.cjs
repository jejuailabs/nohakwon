const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (!process.argv.includes("--live")) throw Error("Use --live for disposable Firestore integration fixtures; --with-ai also prepares a real public catalog unit.");
const result = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "apps/web/tsconfig.json", "scripts/verify-catalog-preparation.ts", ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --conditions=react-server`.trim() },
});
process.exitCode = result.status ?? 1;
