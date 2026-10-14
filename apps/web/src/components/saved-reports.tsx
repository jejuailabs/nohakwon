"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import { useEffect, useState } from "react";
import { accountRequest } from "./account-provider";
type Saved = {
  id: string;
  from: string;
  to: string;
  count: number;
  accuracy: number;
  days: number;
  recommendation: string;
};
export function SavedReports() {
  const [reports, setReports] = useState<Saved[]>([]),
    [message, setMessage] = useState("");
  useEffect(() => {
    accountRequest<{ reports: Saved[] }>("/api/reports")
      .then((d) => setReports(d.reports))
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <Localize>
      <section className="panel workspace-stack">
        <div className="section-heading">
          <h2>저장한 주간 리포트</h2>
          <button
            className="secondary-button"
            onClick={() =>
              void accountRequest<{ reports: Saved[] }>(
                "/api/reports",
                "POST",
                {},
              )
                .then((d) => {
                  setReports(d.reports);
                  setMessage("이번 주 리포트를 저장했어요.");
                })
                .catch((e) => setMessage(e.message))
            }
          >
            이번 주 리포트 저장
          </button>
        </div>
        {reports.map((r) => (
          <details key={r.id}>
            <summary>
              {r.from} ~ {r.to} · {r.count}문제 · {r.accuracy}%
            </summary>
            <p>
              {r.days}일 학습 · {r.recommendation}
            </p>
          </details>
        ))}
        {!reports.length && (
          <p className="muted">리포트를 저장하면 이전 주와 비교할 수 있어요.</p>
        )}
        {message && <p role="status">{message}</p>}
      </section>
    </Localize>
  );
}
