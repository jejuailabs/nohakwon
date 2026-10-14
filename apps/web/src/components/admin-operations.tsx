"use client";
import { useEffect, useState } from "react";
import { accountRequest } from "./account-provider";
import { Localize } from "./localize";
import {
  SUBJECT_NAMES,
  type Report,
  type Result,
  type Book,
} from "@/lib/learning";
type Operations = {
  orders: {
    id: string;
    studentId: string;
    amount: number;
    status: string;
    createdAt: string;
    lastError: string;
  }[];
  deletions: { id: string; status: string; resolution: string }[];
  maintenance: { lastRun?: string; failed?: number } | null;
  learner: {
    id: string;
    nickname: string;
    books: Book[];
    report: Report;
    recent: Result[];
    reports: {
      id: string;
      from: string;
      to: string;
      count: number;
      accuracy: number;
    }[];
  } | null;
};
export function AdminOperations({ studentId }: { studentId: string }) {
  const [data, setData] = useState<Operations | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(
      await accountRequest<Operations>(
        `/api/admin/operations${studentId ? `?studentId=${studentId}` : ""}`,
      ),
    );
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [studentId]);
  async function act(body: unknown) {
    setBusy(true);
    try {
      await accountRequest("/api/admin/operations", "POST", body);
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localize>
      <div className="workspace-stack">
        {error && <p role="alert">{error}</p>}
        <section className="panel">
          <h2>정기 작업</h2>
          <p>
            중단된 출제 재개, 주간 리포트 발행, 만기 구독 갱신을 처리합니다.
          </p>
          <p className="muted">
            마지막 실행: {data?.maintenance?.lastRun ?? "실행 기록 없음"} · 실패{" "}
            {data?.maintenance?.failed ?? 0}
          </p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "정기 작업을 실행할까요? 만기 유료 구독은 등록한 결제 설정으로 갱신됩니다.",
                )
              )
                void act({ action: "maintenance" });
            }}
          >
            정기 작업 실행
          </button>
        </section>
        {data?.learner && (
          <section className="panel workspace-stack">
            <h2>{data.learner.nickname} · 학습 상세</h2>
            <p>
              최근 7일 {data.learner.report.count}문제 · 정답률{" "}
              {data.learner.report.accuracy}% · {data.learner.report.days}일
              학습
            </p>
            <p>{data.learner.report.recommendation}</p>
            <div className="workspace-actions">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void act({ action: "report", studentId })}
              >
                주간 리포트 재생성
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  const days = window.prompt("체험 연장 일수 (1~30)");
                  if (days)
                    void act({
                      action: "extendTrial",
                      studentId,
                      days: Number(days),
                    });
                }}
              >
                체험 기간 연장
              </button>
            </div>
            <details>
              <summary>최근 답안 50개</summary>
              {data.learner.recent.map((r) => (
                <p key={r.id}>
                  {r.date} · {SUBJECT_NAMES[r.subject]} · {r.concept} ·{" "}
                  {r.correct ? "정답" : "오답"} · {r.seconds}초
                </p>
              ))}
            </details>
            {data.learner.reports.map((r) => (
              <p key={r.id}>
                {r.from} ~ {r.to} · {r.count}문제 · {r.accuracy}%
              </p>
            ))}
          </section>
        )}
        <section className="panel admin-scroll">
          <h2>구독·결제 내역</h2>
          <p className="muted">
            결제 취소·환불은 결제사에서 확인 후 처리하며, 웹훅으로 이용 권한이
            반영됩니다.
          </p>
          <a
            href="https://developers.tosspayments.com/"
            target="_blank"
            rel="noreferrer"
          >
            토스페이먼츠 관리 화면
          </a>
          <table className="admin-table">
            <thead>
              <tr>
                <th>주문</th>
                <th>금액</th>
                <th>상태</th>
                <th>확인 안내</th>
              </tr>
            </thead>
            <tbody>
              {data?.orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td>{o.amount.toLocaleString()}원</td>
                  <td>{o.status}</td>
                  <td>{o.lastError}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.orders.length && <p>결제 내역이 없습니다.</p>}
        </section>
        <section className="panel workspace-stack">
          <h2>계정 삭제 요청</h2>
          <p className="muted">
            결제 기록이 있는 계정은 보존 범위를 검토합니다. 메모 저장은 실제
            데이터 삭제를 수행하지 않습니다.
          </p>
          {data?.deletions.map((d) => (
            <article key={d.id}>
              <p>
                {d.id} · {d.status}
              </p>
              <p>{d.resolution}</p>
              <button
                className="secondary-button"
                onClick={() => {
                  const resolution = window.prompt("보존 범위와 처리 메모");
                  if (resolution)
                    void act({
                      action: "deletionReview",
                      id: d.id,
                      resolution,
                    });
                }}
              >
                검토 메모 저장
              </button>
            </article>
          ))}
          {data && !data.deletions.length && <p>삭제 요청이 없습니다.</p>}
        </section>
      </div>
    </Localize>
  );
}
export function ConceptEditor() {
  const [items, setItems] = useState<
      {
        id: string;
        title: string;
        subject: string;
        grade: number;
        standardCodes: string[];
        prerequisites: string[];
      }[]
    >([]),
    [editing, setEditing] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const r = await accountRequest<{ concepts: typeof items }>(
      "/api/admin/operations?view=concepts",
    );
    setItems(r.concepts);
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  return (
    <Localize>
      <section className="panel workspace-stack">
        <h2>성취기준·개념</h2>
        <p className="muted">
          공식 성취기준 코드와 개념을 등록하고, 먼저 배울 개념을 연결합니다.
          순환 연결은 저장할 수 없습니다.
        </p>
        <button
          className="primary-button"
          onClick={() =>
            setEditing(
              JSON.stringify(
                {
                  id: crypto.randomUUID(),
                  title: "",
                  subject: "math",
                  grade: 1,
                  standardCodes: [],
                  prerequisites: [],
                },
                null,
                2,
              ),
            )
          }
        >
          새 개념
        </button>
        {items.map((c) => (
          <article className="panel" key={c.id}>
            <h3>{c.title}</h3>
            <p>{c.standardCodes.join(" · ")}</p>
            <p>
              {c.prerequisites
                .map((p) => items.find((i) => i.id === p)?.title)
                .join(" + ")}{" "}
              → {c.title}
            </p>
            <button
              className="secondary-button"
              onClick={() => setEditing(JSON.stringify(c, null, 2))}
            >
              개념 편집
            </button>
          </article>
        ))}
        {editing && (
          <>
            <label>
              개념 JSON
              <textarea
                className="admin-json"
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
              />
            </label>
            <button
              className="primary-button"
              onClick={async () => {
                try {
                  await accountRequest("/api/admin/operations", "POST", {
                    action: "concept",
                    concept: JSON.parse(editing),
                  });
                  setEditing("");
                  await load();
                  setMessage("개념을 저장했어요.");
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              개념 저장
            </button>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </section>
    </Localize>
  );
}
