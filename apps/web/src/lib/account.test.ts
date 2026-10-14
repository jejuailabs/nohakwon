import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountError, assertFreshGoogleSignIn, assertSameOrigin, parseProfileInput, progressStorageKey } from "./account";

test("profile input normalizes names and only accepts supported grades", () => {
  assert.deepEqual(parseProfileInput({ nickname: "  별빛  ", grade: 2, calm: true }), { nickname: "별빛", grade: 2, calm: true });
  for (const value of [null, [], { nickname: "", grade: 1, calm: false }, { nickname: "a".repeat(21), grade: 1, calm: false }, { nickname: "학생\n이름", grade: 1, calm: false }, { nickname: "학생", grade: "1", calm: false }, { nickname: "학생", grade: 4, calm: false }]) assert.throws(() => parseProfileInput(value), AccountError);
});
test("profile writes cannot assign ownership, role, points, or identifiers", () => {
  for (const field of ["uid", "id", "guardianUid", "role", "admin", "points", "activeStudentId", "createdAt"]) assert.throws(() => parseProfileInput({ nickname: "학생", grade: 1, calm: false, [field]: "attacker" }), AccountError);
});
test("cross-origin and missing CSRF headers are rejected, including sibling origins", () => {
  assert.doesNotThrow(() => assertSameOrigin("https://app.example.com", "https://app.example.com/api/session", "web"));
  for (const origin of [null, "null", "https://other.example.com", "http://app.example.com", "https://app.example.com.attacker.com"]) assert.throws(() => assertSameOrigin(origin, "https://app.example.com", "web"), AccountError);
  assert.throws(() => assertSameOrigin("https://app.example.com", "https://app.example.com", null), AccountError);
});
test("session exchange requires a recent verified Google login", () => {
  const now = 1_800_000_000_000;
  const valid = { auth_time: now / 1000 - 30, firebase: { sign_in_provider: "google.com" }, email_verified: true };
  assert.doesNotThrow(() => assertFreshGoogleSignIn(valid, now));
  for (const token of [{ ...valid, auth_time: now / 1000 - 301 }, { ...valid, auth_time: now / 1000 + 120 }, { ...valid, auth_time: NaN }, { ...valid, firebase: { sign_in_provider: "custom" } }, { ...valid, email_verified: false }]) assert.throws(() => assertFreshGoogleSignIn(token, now), AccountError);
});
test("guest, accounts, pending setups, and learners have distinct local records", () => {
  const user = { uid: "u1", email: null, displayName: null };
  const profile = { id: "s1", nickname: "학생", grade: 1 as const, calm: false };
  const keys = [progressStorageKey(null, null), progressStorageKey(user, null), progressStorageKey(user, profile), progressStorageKey({ ...user, uid: "u2" }, profile), progressStorageKey(user, { ...profile, id: "s2" })];
  assert.equal(new Set(keys).size, 5);
  assert.equal(keys[0], "nohakwon:learning:v1");
  assert.notEqual(progressStorageKey({ ...user, uid: "a:b" }, { ...profile, id: "c" }), progressStorageKey({ ...user, uid: "a" }, { ...profile, id: "b:c" }));
});
