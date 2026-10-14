"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AccountSession, LearnerProfile, ProfileInput } from "@/lib/account";

export async function accountRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-NoHakwon-Client": "web" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "서버 연결을 확인해 주세요.");
  return data;
}

type AccountContextValue = AccountSession & { loading: boolean; error: string; refresh: () => Promise<void>; saveProfile: (profile: ProfileInput) => Promise<void>; logout: () => Promise<void> };
const AccountContext = createContext<AccountContextValue | null>(null);
const empty: AccountSession = { configured: false, user: null, profile: null };

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AccountSession>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try { setSession(await accountRequest<AccountSession>("/api/session")); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "계정을 불러오지 못했어요."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    // A session change in another tab must reload before any more local writes.
    const changed = (event: StorageEvent) => { if (event.key === "nohakwon:account-change") window.location.reload(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refresh]);
  async function saveProfile(input: ProfileInput) {
    const { profile } = await accountRequest<{ profile: LearnerProfile }>("/api/profile", "PUT", input);
    setSession(previous => ({ ...previous, profile }));
    broadcastAccountChange();
  }
  async function logout() {
    await accountRequest("/api/session", "DELETE");
    broadcastAccountChange();
    window.location.assign("/b");
  }
  return <AccountContext.Provider value={{ ...session, loading, error, refresh, saveProfile, logout }}>{children}</AccountContext.Provider>;
}
export function broadcastAccountChange() {
  try { localStorage.setItem("nohakwon:account-change", `${Date.now()}:${Math.random()}`); } catch { /* Session still works without browser storage. */ }
}
export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("AccountProvider is missing");
  return context;
}
