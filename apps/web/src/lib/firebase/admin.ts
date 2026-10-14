import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { AccountError } from "@/lib/account";

export function firebaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID && process.env.FIREBASE_ADMIN_PROJECT_ID && process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY);
}

function adminApp() {
  if (!firebaseConfigured()) throw new AccountError(503, "로그인 연결을 준비하고 있어요. 먼저 학습을 체험해 보세요.");
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new AccountError(503, "로그인 프로젝트 설정을 확인해야 합니다.");
  return getApps().find(app => app.name === "nohakwon-server") ?? initializeApp({
    credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n") }),
  }, "nohakwon-server");
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
