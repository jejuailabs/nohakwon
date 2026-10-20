"use client";
import { useEffect, useState } from "react";
import { BookOpen, RefreshCw, Sparkles } from "lucide-react";
import { accountRequest } from "./account-provider";
import { gradeLabel } from "@/lib/education";
type Snapshot = {
  total: number;
  counts: Record<string, number>;
  approved: number;
  initialQuestions: number;
  rows: {
    id: string;
    bookTitle: string;
    publisher: string;
    grade: number;
    schoolLevel: "elementary" | "middle";
    unitTitle: string;
    status: string;
    approved: number;
    target: number;
    error: string;
    stage: string;
  }[];
};
const labels: Record<string, string> = {
  queued: "준비 대기",
  running: "준비 중",
  ready: "준비 완료",
  blocked: "내용 확인 필요",
  failed: "재시도 필요",
};
export function CatalogPreparationPanel() {
  const [data, setData] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  async function load() {
    setData(await accountRequest<Snapshot>("/api/admin/catalog-preparation"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function act(action: string, id?: string) {
    setBusy(true);
    setError("");
    try {
      await accountRequest("/api/admin/catalog-preparation", "POST", {
        action,
        ...(id ? { id } : {}),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel workspace-stack">
      <div className="section-heading">
        <h2>
          <BookOpen size={22} /> 첫 학습 문제 준비
        </h2>
        <span className="tag">
          <Sparkles size={14} /> 다음 단원 자동 준비
        </span>
      </div>
      <p>
        모든 교재의 첫 단원을 검증 문항 {data?.initialQuestions ?? 10}개
        이상으로 준비합니다. 학습자가 진입하면 바로 다음 단원을 준비하며, 개인의
        진도와 복습 기록은 바꾸지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <p className="muted">
        전체 {data?.total ?? 0}개 교재·학년·단원 범위 · 준비 완료{" "}
        {data?.counts.ready ?? 0}개 · 검증 문항 {data?.approved ?? 0}개
      </p>
      <div className="workspace-actions">
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void act("bootstrap")}
        >
          전체 교재 첫 단원 준비
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void act("resume")}
        >
          중단 작업 재개
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={16} /> 상태 새로고침
        </button>
      </div>
      <label>
        준비 상태{" "}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">전체</option>
          {Object.entries(labels).map(([key, label]) => (
            <option key={key} value={key}>
              {label} ({data?.counts[key] ?? 0})
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        공식 자료로 범위나 정답을 확인하지 못한 문제는 자동으로 배포하지
        않습니다. ‘내용 확인 필요’에서 사유를 확인할 수 있습니다.
      </p>
      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>교재·출판사</th>
              <th>단원</th>
              <th>준비 상태</th>
              <th>검증 문항</th>
              <th>확인</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows
              .filter((p) => filter === "all" || p.status === filter)
              .map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.bookTitle}
                    <small className="muted">
                      {" "}
                      {p.publisher} · {gradeLabel(p)}
                    </small>
                  </td>
                  <td>{p.unitTitle}</td>
                  <td>{labels[p.status] ?? p.status}</td>
                  <td>
                    {p.approved} / {p.target}
                  </td>
                  <td>
                    <small>{p.error || p.stage}</small>
                    {["blocked", "failed"].includes(p.status) && (
                      <button
                        disabled={busy}
                        className="secondary-button"
                        onClick={() => void act("retry", p.id)}
                      >
                        다시 준비
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
