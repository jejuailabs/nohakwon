import test from "node:test";
import assert from "node:assert/strict";
import { sourceEvidenceOptions } from "./source-evidence";
test("grounding choices preserve decimals, mathematical symbols, line endings and literal source wording", () => {
  const source = "정확한 인용이다. 0.2×5=1이다.\r\n해는 등식을 참으로 만드는 미지수의 값이다.\n같은 문장.\n같은 문장.";
  const options = sourceEvidenceOptions(source);
  assert.ok(options.includes("0.2×5=1이다."));
  assert.ok(options.includes("해는 등식을 참으로 만드는 미지수의 값이다."));
  assert.ok(options.every((s) => source.includes(s)));
  assert.equal(options.filter((s) => s === "같은 문장.").length, 1);
});
test("long sources have bounded literal choices sampled across the full material", () => {
  const source = Array.from({ length: 300 }, (_, i) => `${i}: ${"원문 자료 ".repeat(100)}`).join("\n");
  const options = sourceEvidenceOptions(source);
  assert.equal(options.length, 120);
  assert.ok(options.every((s) => s.length <= 400 && source.includes(s)));
  assert.ok(options[0].startsWith("0:"));
  assert.ok(options.at(-1)!.includes("원문"));
  assert.deepEqual(sourceEvidenceOptions("   \n "), []);
});
