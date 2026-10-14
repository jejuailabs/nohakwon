"use client";
import { useEffect, useState } from "react";
import { accountRequest } from "./account-provider";
import { Localize } from "./localize";
type Links = {
  linked: boolean;
  requests: { id: string; email: string; status: string; createdAt: string }[];
};
export function FamilyLinks() {
  const [data, setData] = useState<Links | null>(null),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await accountRequest<Links>("/api/family/link"));
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    try {
      const r = await accountRequest<{ code?: string }>(
        "/api/family/link",
        "POST",
        body,
      );
      setCode(r.code ?? "");
      setMessage("연결 설정을 저장했어요.");
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localize>
      <section className="panel workspace-stack">
        <h2>학생 Google 계정 연결</h2>
        <p className="muted">
          학생에게 코드를 전달하고, 아래에서 요청을 승인해 주세요. 학생은 이
          프로필의 학습 기록에 접근하며 결제·보호자 관리는 할 수 없습니다.
        </p>
        {data?.linked ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "학생의 별도 로그인을 해제할까요? 학습 기록은 유지됩니다.",
                )
              )
                void act({ action: "unlink" });
            }}
          >
            학생 계정 연결 해제
          </button>
        ) : (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "invite", email });
            }}
          >
            <label>
              학생 Google 이메일
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="primary-button" disabled={busy}>
              24시간 초대 코드 만들기
            </button>
          </form>
        )}
        {code && <p data-localize="off">{code}</p>}
        {data?.requests
          .filter((r) => r.status === "pending")
          .map((r) => (
            <div className="panel" key={r.id}>
              <strong data-localize="off">{r.email}</strong>
              <p>이 학생에게 현재 프로필의 학습 권한을 부여할까요?</p>
              <div className="workspace-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void act({ action: "approve", id: r.id })}
                >
                  연결 승인
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void act({ action: "reject", id: r.id })}
                >
                  거절
                </button>
              </div>
            </div>
          ))}
        <button
          className="secondary-button"
          onClick={() => void load().catch((e) => setMessage(e.message))}
        >
          연결 요청 새로고침
        </button>
        {message && <p role="status">{message}</p>}
      </section>
    </Localize>
  );
}
export function RedeemInvite() {
  const [code, setCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Localize>
      <details className="panel">
        <summary>학생 계정으로 초대 코드 입력</summary>
        <form
          className="workspace-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await accountRequest<{ message: string }>(
                "/api/family/link",
                "POST",
                { action: "redeem", code },
              );
              setMessage(r.message);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            보호자 초대 코드
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="primary-button" disabled={busy}>
            연결 요청
          </button>
          <p role="status">{message}</p>
          <a href="/b" className="secondary-button">
            승인 후 이어서 시작
          </a>
        </form>
      </details>
    </Localize>
  );
}
