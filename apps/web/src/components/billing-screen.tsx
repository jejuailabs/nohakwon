"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import Link from "next/link";
import { useEffect, useState } from "react";
import { accountRequest } from "./account-provider";
import type { Entitlement } from "@/lib/learning";
type Status = {
  configured: boolean;
  test: boolean;
  entitlement: Entitlement;
  amount: number;
  cardRegistered: boolean;
  cancelAtPeriodEnd: boolean;
  orders: {
    id: string;
    status: string;
    amount: number;
    createdAt: string;
    periodEnd: string;
  }[];
};
type Toss = {
  payment: (v: { customerKey: string }) => {
    requestBillingAuth: (v: {
      method: string;
      successUrl: string;
      failUrl: string;
    }) => Promise<void>;
  };
};
declare global {
  interface Window {
    TossPayments?: (key: string) => Toss;
  }
}
export function BillingScreen({ complete = false }: { complete?: boolean }) {
  const [data, setData] = useState<Status | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false);
  async function load() {
    setData(await accountRequest<Status>("/api/billing"));
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function register() {
    await act(async () => {
      const prepared = await accountRequest<{
        state: string;
        customerKey: string;
        clientKey: string;
      }>("/api/billing", "POST", { action: "prepare", consent });
      if (!window.TossPayments)
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://js.tosspayments.com/v2/standard";
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error("결제창을 불러오지 못했어요."));
          document.head.appendChild(script);
        });
      if (!window.TossPayments) throw new Error("결제창 연결을 확인해 주세요.");
      await window
        .TossPayments(prepared.clientKey)
        .payment({ customerKey: prepared.customerKey })
        .requestBillingAuth({
          method: "CARD",
          successUrl: `${window.location.origin}/billing/success?state=${prepared.state}`,
          failUrl: `${window.location.origin}/billing/fail`,
        });
    });
  }
  async function confirm() {
    await act(async () => {
      const params = new URLSearchParams(window.location.search);
      await accountRequest("/api/billing", "POST", {
        action: "complete",
        state: params.get("state"),
        authKey: params.get("authKey"),
        customerKey: params.get("customerKey"),
      });
      window.history.replaceState({}, "", "/billing/success");
      setMessage("결제가 완료되었어요. 이용 기간이 적용되었습니다.");
    });
  }
  return (
    <PersistedLocale>
      <Localize>
        <main className="app theme-b billing-app">
          <div className="billing-main workspace-stack">
            <Link href="/b?view=family">← 보호자 화면으로</Link>
            <section className="panel">
              <span className="eyebrow">LEARNING MEMBERSHIP</span>
              <h1>학습 구독 관리</h1>
              {data ? (
                <>
                  <span className="tag">
                    {data.test ? "테스트 환경 · 실제 청구 없음" : "실결제 환경"}
                  </span>
                  <strong className="billing-price">
                    {data.amount.toLocaleString()}원{" "}
                    <small>/ 월 · 학습자 1명</small>
                  </strong>
                  <p>
                    교재에 맞춘 새 문제, 복습 일정, 학습 리포트를 이용합니다.
                  </p>
                  {!data.configured ? (
                    <p className="storage-warning">
                      결제 서비스 미연결: 토스페이먼츠의 테스트 클라이언트
                      키·시크릿 키를 연결하면 카드 등록부터 결제·해지까지
                      테스트할 수 있어요.
                    </p>
                  ) : complete ? (
                    <>
                      <p>
                        카드 인증이 끝났어요. 아래 버튼을 누르면 첫 달 구독료를
                        결제하고 구독을 시작합니다.
                      </p>
                      <button
                        className="primary-button"
                        disabled={busy || data.entitlement.status === "active"}
                        onClick={() => void confirm()}
                      >
                        {busy
                          ? "결제 확인 중"
                          : data.test
                            ? "테스트 결제 완료하기"
                            : "첫 달 결제하고 구독 시작"}
                      </button>
                    </>
                  ) : data.entitlement.status === "active" ? (
                    <>
                      <p>
                        {new Date(
                          data.entitlement.paidUntil,
                        ).toLocaleDateString("ko-KR")}
                        까지 이용할 수 있어요.
                      </p>
                      <p>
                        {data.cancelAtPeriodEnd
                          ? "해지 예약됨 · 다음 결제 없음"
                          : "매월 자동 결제됩니다."}
                      </p>
                      <button
                        className="secondary-button"
                        disabled={busy || data.cancelAtPeriodEnd}
                        onClick={() => {
                          if (
                            window.confirm(
                              "다음 자동 결제를 중단할까요? 결제한 기간까지 이용할 수 있어요.",
                            )
                          )
                            void act(async () => {
                              await accountRequest("/api/billing", "POST", {
                                action: "cancel",
                              });
                              setMessage("해지 예약을 완료했어요.");
                            });
                        }}
                      >
                        자동 결제 해지
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        월 {data.amount.toLocaleString()}원 자동 결제와 언제든
                        해지 가능한 조건을 확인했습니다.
                      </label>
                      <button
                        className="primary-button"
                        disabled={busy || !consent}
                        onClick={() => void register()}
                      >
                        {data.test
                          ? "테스트 카드 등록"
                          : "카드 등록하고 구독 준비"}
                      </button>
                      <p className="muted small">
                        카드 인증 후 첫 달 결제를 별도로 확인합니다. 실제 카드
                        정보는 노학원 서버가 받지 않습니다.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p>결제 상태를 불러오는 중…</p>
              )}
              {message && (
                <p className="workspace-notice" role="status">
                  {message}
                </p>
              )}
            </section>
            {data && data.orders.length > 0 && (
              <section className="panel">
                <h2>결제 내역</h2>
                {data.orders.map((o) => (
                  <div key={o.id} className="row-between">
                    <div>
                      <strong>
                        {o.amount.toLocaleString()}원 · {o.status}
                      </strong>
                      <p className="muted small">{o.createdAt.slice(0, 10)}</p>
                    </div>
                    {o.status === "PENDING" && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await accountRequest("/api/billing", "POST", {
                              action: "reconcile",
                              orderId: o.id,
                            });
                          })
                        }
                      >
                        결과 다시 확인
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        </main>
      </Localize>
    </PersistedLocale>
  );
}
