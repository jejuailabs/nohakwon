"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PROGRESS, parseProgress, type Progress } from "@nohakwon/core";
import { useAccount } from "@/components/account-provider";
import { progressStorageKey } from "@/lib/account";

export const STORAGE_KEY = "nohakwon:learning:v1";

export function useProgress() {
  const account = useAccount();
  const storageKey = progressStorageKey(account.user, account.profile);
  const nickname = account.profile?.nickname;
  const calm = account.profile?.calm;
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const current = useRef(progress);
  useEffect(() => {
    if (account.loading || account.error) return;
    const settings = (value: Progress) => nickname ? { ...value, name: nickname, calm: calm ?? false } : value;
    current.current = settings(DEFAULT_PROGRESS);
    setProgress(current.current);
    setStorageError("");
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = parseProgress(raw);
      if (saved) { current.current = settings(saved); setProgress(current.current); }
      else if (raw) setStorageError("저장된 기록을 읽지 못했습니다. 이번 학습부터 새 기록으로 저장됩니다.");
    } catch { setStorageError("브라우저 저장소를 사용할 수 없어 이번 창에서만 기록이 유지됩니다."); }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = parseProgress(event.newValue);
      if (next || event.newValue === null) { current.current = settings(next ?? DEFAULT_PROGRESS); setProgress(current.current); }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey, nickname, calm, account.loading, account.error]);
  const update = useCallback((transform: (previous: Progress) => Progress) => {
    // Read the most recent local value to avoid overwriting progress from the other design tab.
    let previous = current.current;
    try { previous = parseProgress(localStorage.getItem(storageKey)) ?? previous; } catch { /* In-memory mode */ }
    if (nickname) previous = { ...previous, name: nickname, calm: calm ?? false };
    const next = transform(previous);
    current.current = next;
    setProgress(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setStorageError("기록을 저장할 공간이 부족하거나 저장이 차단되어 있습니다. 이 창을 닫으면 새 기록이 사라질 수 있습니다."); }
    return next;
  }, [storageKey, nickname, calm]);
  return { progress, ready, update, storageError };
}
