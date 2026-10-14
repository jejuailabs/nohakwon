"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from "firebase/auth";

export async function googleIdToken() {
  const app = getApps().find(item => item.name === "nohakwon-client") ?? initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }, "nohakwon-client");
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await signInWithPopup(auth, provider);
    return await credential.user.getIdToken();
  } finally {
    await signOut(auth);
  }
}

export function signInError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "로그인 창이 닫혔어요. 준비되면 다시 시작해 주세요.";
  if (code === "auth/popup-blocked") return "브라우저에서 로그인 팝업을 허용한 뒤 다시 눌러 주세요.";
  if (code === "auth/unauthorized-domain") return "현재 접속 주소에 Google 로그인이 아직 허용되지 않았어요. 서비스 설정을 확인해 주세요.";
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") return "Google 로그인 연결을 준비하고 있어요. 먼저 학습을 체험해 보세요.";
  if (code === "auth/network-request-failed") return "인터넷 연결을 확인하고 다시 시도해 주세요.";
  return code ? "Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요." : error instanceof Error ? error.message : "로그인에 실패했어요. 다시 시도해 주세요.";
}
