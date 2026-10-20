const { spawnSync } = require("node:child_process");
const path = require("node:path");
const result = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "apps/web/tsconfig.json", "scripts/prepare-catalog.ts", ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --conditions=react-server`.trim() },
});
process.exitCode = result.status ?? 1;
