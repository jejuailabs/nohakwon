"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import { useState } from "react";
import { googleIdToken, signInError } from "@/lib/firebase/client";
import { accountRequest, broadcastAccountChange } from "./account-provider";
export function DeleteAccount() {
  const [expanded, setExpanded] = useState(false),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const idToken = await googleIdToken(),
        result = await accountRequest<{ deleted?: boolean; message?: string }>(
          "/api/account/delete",
          "POST",
          { idToken, confirm },
        );
      if (result.deleted) {
        broadcastAccountChange();
        window.location.assign("/login");
      } else setMessage(result.message ?? "삭제 요청을 접수했습니다.");
    } catch (e) {
      setMessage(signInError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localize>
      <section className="panel">
        <button className="text-danger" onClick={() => setExpanded(!expanded)}>
          계정 삭제
        </button>
        {expanded && (
          <div className="workspace-stack">
            <p>
              소유한 학습 프로필, 교재와 답안이 삭제되며 복구할 수 없습니다.
              먼저 데이터를 다운로드해 주세요. 결제 이력이 있으면 운영자 확인 후
              처리합니다.
            </p>
            <label>
              계속하려면 ‘계정 삭제’를 입력하세요
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              disabled={confirm !== "계정 삭제" || busy}
              onClick={() => void remove()}
            >
              {busy ? "처리 중" : "Google로 본인 확인 후 삭제"}
            </button>
            {message && <p role="alert">{message}</p>}
          </div>
        )}
      </section>
    </Localize>
  );
}
