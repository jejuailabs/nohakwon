"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronRight, History } from "lucide-react";
import {
  answerLabel,
  type Book,
  type HistoryEntry,
  type LearnMode,
} from "@/lib/learning";
import { accountRequest } from "./account-provider";
import { AdventureHeader, AdventureEmpty, SubjectCompanion } from "./adventure";
import { MASTERY_LABELS } from "./adaptive-map";
import { Localize } from "./localize";
export const MODE_LABELS: Record<LearnMode, string> = {
  daily: "진도 학습",
  extra: "단원 추가 문제",
  review: "정기 복습",
  reinforce: "취약 유형 보강",
  practice: "같은 문제 다시 풀기",
  assessment: "주간 평가",
  exam: "범위 평가",
};
type Page = { attempts: HistoryEntry[]; nextCursor: string };
export function LearningHistory({ books }: { books: Book[] }) {
  const [date, setDate] = useState(""),
    [mode, setMode] = useState(""),
    [bookId, setBookId] = useState(""),
    [page, setPage] = useState<Page>({ attempts: [], nextCursor: "" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ date, mode, bookId }).toString(),
    current = useRef(query);
  current.current = query;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setPage({ attempts: [], nextCursor: "" });
    accountRequest<Page>(`/api/history?${query}`)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [query, retry]);
  async function more() {
    const captured = query;
    setBusy(true);
    setError("");
    try {
      const result = await accountRequest<Page>(
        `/api/history?${query}&cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      if (current.current === captured)
        setPage((old) => ({
          attempts: [
            ...old.attempts,
            ...result.attempts.filter(
              (r) => !old.attempts.some((p) => p.id === r.id),
            ),
          ],
          nextCursor: result.nextCursor,
        }));
    } catch (e) {
      if (current.current === captured) setError((e as Error).message);
    } finally {
      if (current.current === captured) setBusy(false);
    }
  }
  return (
    <Localize>
      <div className="workspace-stack learning-history">
        <AdventureHeader chapter="history">
          <span className="tag">
            <History size={13} />
            개인별 풀이와 출제 경로
          </span>
        </AdventureHeader>
        <div className="panel form-grid history-filters">
          <label>
            <span>
              <CalendarDays size={15} /> 풀이 날짜 · 한국 시간
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            학습 종류
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">모든 학습</option>
              {Object.entries(MODE_LABELS).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            풀이 교재
            <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">모든 교재</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            onClick={() => {
              setDate("");
              setMode("");
              setBookId("");
            }}
          >
            조회 조건 초기화
          </button>
        </div>
        {error && (
          <div role="alert" className="storage-warning">
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              다시 불러오기
            </button>
          </div>
        )}
        {page.attempts.map((r) => (
          <HistoryCard
            key={r.id}
            entry={r}
            book={books.find((b) => b.id === r.bookId)}
          />
        ))}
        {busy && (
          <p className="workspace-notice" role="status">
            풀이 기록을 불러오고 있어요.
          </p>
        )}
        {!busy && !error && !page.attempts.length && (
          <AdventureEmpty
            subject="social"
            title="이 조건의 풀이 기록이 없어요"
            description="답안을 제출하면 날짜와 학습 종류별로 기록이 남아요. 이해도를 선택하지 않은 답안도 확인할 수 있어요."
          />
        )}
        {page.nextCursor && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void more()}
          >
            이전 풀이 기록 더 보기
            <ChevronRight size={15} />
          </button>
        )}
        <p className="small muted">
          문제를 배정한 이유는 새 버전부터 기록합니다. 이전 버전의
          정오답·이해도·풀이 날짜는 그대로 보존하며, 당시 남기지 않은 분기
          이유는 추정하지 않습니다.
        </p>
      </div>
    </Localize>
  );
}
function HistoryCard({ entry: r, book }: { entry: HistoryEntry; book?: Book }) {
  const [previous, setPrevious] = useState<HistoryEntry | null>(null),
    [message, setMessage] = useState("");
  const change = r.reviewChange;
  return (
    <article className="panel history-card workspace-stack">
      <div className="row-between">
        <SubjectCompanion subject={r.subject} detail={r.concept} />
        <time dateTime={r.at}>
          {r.date} ·{" "}
          {new Date(r.at).toLocaleTimeString("ko-KR", {
            timeZone: "Asia/Seoul",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <div className="history-tags">
        <span className="tag">{MODE_LABELS[r.mode]}</span>
        <span
          className={`tag ${r.correct ? "status-completed" : "status-failed"}`}
        >
          {r.correct ? "정답" : "오답"}
        </span>
        <span className="tag">
          {r.confidence === "known"
            ? "알겠어요"
            : r.confidence === "unsure"
              ? "헷갈려요"
              : r.confidence === "unknown"
                ? "모르겠어요"
                : "이해도 미선택"}
        </span>
        <span className="small muted">{`${r.seconds}초`}</span>
      </div>
      <p className="small muted">
        {r.bookTitle ?? book?.title ?? "이전 교재"} ·{" "}
        {r.unitTitle ??
          book?.units.find((u) => u.id === r.unitId)?.title ??
          r.unitId}
        {r.skillType ? ` · ${r.skillType}` : ""}
      </p>
      <h2 data-localize="off">{r.prompt}</h2>
      <p>
        나의 답:{" "}
        <span data-localize="off">{answerLabel(r.answer, r.choices)}</span> ·
        정답:{" "}
        <span data-localize="off">
          {answerLabel(r.correctAnswer, r.choices)}
        </span>
      </p>
      <p className="history-reason">
        {r.selectionReason?.label ??
          "이전 버전 기록 · 출제 이유는 별도로 남기지 않았어요."}
      </p>
      <details>
        <summary>해설과 복습 분기 보기</summary>
        <div className="workspace-stack">
          <p data-localize="off">{r.explanation}</p>
          {r.phase === "awaiting-understanding" ? (
            <p className="workspace-notice">
              답안은 저장됐어요. 당시 이해도를 선택하지 않아 복습 일정과
              숙련도에는 아직 반영하지 않았어요.
            </p>
          ) : change ? (
            <div className="review-change">
              <div>
                <span>이 유형의 정기 복습일</span>
                <strong>
                  {change.previousDue || "첫 기록"} →{" "}
                  {change.nextDue || "변경 없음"}
                </strong>
              </div>
              <div>
                <span>유형 확인 상태</span>
                <strong>
                  {MASTERY_LABELS[
                    change.previousMastery as keyof typeof MASTERY_LABELS
                  ] ?? "학습 중"}{" "}
                  →{" "}
                  {MASTERY_LABELS[
                    change.nextMastery as keyof typeof MASTERY_LABELS
                  ] ?? "학습 중"}
                </strong>
              </div>
              <p className="small muted">
                {r.mode === "practice"
                  ? "같은 문제 다시 풀기는 복습 일정과 숙련도를 바꾸지 않아요."
                  : "정오답·해설 후 이해도·서로 다른 문항과 날짜의 기록을 반영했어요."}
              </p>
            </div>
          ) : r.dueDate ? (
            <p>{`당시 기록한 다음 복습일: ${r.dueDate}`}</p>
          ) : null}
          {r.selectionReason?.triggerAttemptId && (
            <button
              className="secondary-button"
              onClick={() => {
                setMessage("이전 풀이를 찾고 있어요.");
                void accountRequest<{ attempt: HistoryEntry }>(
                  `/api/history?attemptId=${encodeURIComponent(r.selectionReason!.triggerAttemptId)}`,
                )
                  .then((data) => {
                    setPrevious(data.attempt);
                    setMessage("");
                  })
                  .catch((e) => setMessage(e.message));
              }}
            >
              이 문제로 이어진 이전 풀이
            </button>
          )}
          {previous && (
            <div className="workspace-notice">
              <strong>
                {previous.date} · {MODE_LABELS[previous.mode]}
              </strong>
              <p data-localize="off">{previous.prompt}</p>
              <p>
                {previous.correct ? "정답" : "오답"} ·{" "}
                {previous.confidence === "known"
                  ? "알겠어요"
                  : previous.confidence === "unsure"
                    ? "헷갈려요"
                    : previous.confidence === "unknown"
                      ? "모르겠어요"
                      : "이해도 미선택"}
              </p>
            </div>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      </details>
    </article>
  );
}
