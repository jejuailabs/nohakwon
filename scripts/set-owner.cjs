// Explicit administrative setup, run only by the project operator.
const { loadEnvConfig } = require("@next/env");
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
loadEnvConfig(require("node:path").resolve("apps/web"));
const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/set-owner.cjs <Google account email>");
  process.exit(1);
}
(async () => {
  const app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  const auth = getAuth(app),
    user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, {
    ...user.customClaims,
    nohakwonRole: "owner",
  });
  await getFirestore(app)
    .collection("auditLogs")
    .add({
      uid: user.uid,
      action: "bootstrap-owner",
      target: user.uid,
      at: new Date().toISOString(),
    });
  console.log(
    "Project owner role configured for the specified Google account.",
  );
})().catch((e) => {
  console.error(e.code || "Owner setup failed");
  process.exitCode = 1;
});
