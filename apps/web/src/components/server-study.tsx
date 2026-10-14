"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import { useEffect, useState, useRef } from "react";
import { CheckCircle2, ChevronRight, X, Bookmark, Flag } from "lucide-react";
import type { Confidence } from "@nohakwon/core";
import {
  SUBJECT_NAMES,
  answerLabel,
  type ServedQuestion,
  type Result,
  type LearnMode,
} from "@/lib/learning";
import { accountRequest } from "./account-provider";
export type StudyAssignment = {
  id: string;
  date: string;
  mode: LearnMode;
  questions: ServedQuestion[];
  results: Record<string, Result>;
};
export function ServerStudy({
  assignment,
  onClose,
  onUpdate,
}: {
  assignment: StudyAssignment;
  onClose: () => void;
  onUpdate: () => Promise<void>;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [results, setResults] = useState(assignment.results),
    [index, setIndex] = useState(() =>
      Math.max(
        0,
        assignment.questions.findIndex((q) => !assignment.results[q.id]),
      ),
    ),
    [choice, setChoice] = useState<number | string | null>(null),
    [confidence, setConfidence] = useState<Confidence | null>(null),
    [busy, setBusy] = useState(false),
    [opened, setOpened] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(
      assignment.questions.every((q) => assignment.results[q.id]),
    );
  const q = assignment.questions[index],
    result = results[q.id];
  useEffect(() => {
    let active = true;
    setOpened(false);
    setError("");
    accountRequest("/api/learn", "POST", {
      action: "open",
      assignmentId: assignment.id,
      questionId: q.id,
    })
      .then(() => {
        if (active) setOpened(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [assignment.id, q.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),a[href],textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  async function submit() {
    if (choice === null || !confidence) return;
    setBusy(true);
    setError("");
    try {
      const r = await accountRequest<Result>("/api/learn", "POST", {
        action: "answer",
        assignmentId: assignment.id,
        questionId: q.id,
        answer: choice,
        confidence,
      });
      setResults((prev) => ({ ...prev, [q.id]: r }));
      await onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function next() {
    const nextIndex = assignment.questions.findIndex(
      (q, i) => i > index && !results[q.id],
    );
    if (nextIndex < 0) setDone(true);
    else {
      setIndex(nextIndex);
      setChoice(null);
      setConfidence(null);
    }
  }
  return (
    <Localize>
      <div className="study-backdrop">
        <section
          ref={dialog}
          className="server-study panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="study-heading"
        >
          <div className="section-heading">
            <span className="tag">
              {SUBJECT_NAMES[q.subject]} ·{" "}
              {assignment.mode === "review"
                ? "복습"
                : assignment.mode === "assessment"
                  ? "주간 평가"
                  : assignment.mode === "exam"
                    ? "범위 평가"
                    : assignment.mode === "practice"
                      ? "다시 풀기"
                      : "오늘의 학습"}
            </span>
            <button
              autoFocus
              className="icon-button"
              aria-label="학습 닫기"
              onClick={onClose}
            >
              <X />
            </button>
          </div>
          {done ? (
            <div className="study-complete">
              <CheckCircle2 size={55} />
              <h2 id="study-heading">오늘의 한 걸음, 완료!</h2>
              <p>
                {Object.keys(results).length}문제 중{" "}
                {Object.values(results).filter((r) => r.correct).length}문제를
                맞혔어요.
              </p>
              <strong>
                +{Object.values(results).reduce((n, r) => n + r.points, 0)}{" "}
                포인트
              </strong>
              <p className="muted">기록과 복습 일정이 계정에 저장되었습니다.</p>
              <button className="primary-button" onClick={onClose}>
                학습 화면으로
              </button>
            </div>
          ) : (
            <>
              <div className="row-between small">
                <span>{q.concept}</span>
                <span>
                  {index + 1} / {assignment.questions.length}
                </span>
              </div>
              <div className="progress-track">
                <i
                  style={{
                    width: `${(Object.keys(results).length / assignment.questions.length) * 100}%`,
                  }}
                />
              </div>
              <h2
                id="study-heading"
                className="server-question"
                data-localize="off"
              >
                {q.prompt}
              </h2>
              {q.kind === "short" ? (
                <label className="short-answer">
                  답안
                  <input
                    value={typeof choice === "string" ? choice : ""}
                    disabled={!!result || busy || !opened}
                    maxLength={200}
                    onChange={(e) => setChoice(e.target.value)}
                    placeholder="답을 입력해 주세요"
                  />
                </label>
              ) : (
                <div className="server-choices">
                  {q.choices.map((c, i) => (
                    <button
                      key={i}
                      disabled={!!result || busy || !opened}
                      aria-pressed={choice === i}
                      className={`${choice === i ? "selected" : ""} ${result?.correctAnswer === i ? "correct" : ""} ${result && result.answer === i && !result.correct ? "incorrect" : ""}`}
                      onClick={() => setChoice(i)}
                    >
                      <b>{i + 1}</b>
                      <span data-localize="off">{c}</span>
                    </button>
                  ))}
                </div>
              )}
              {!result ? (
                <>
                  <h3 className="confidence-heading">
                    답을 확인하기 전에, 얼마나 이해했나요?
                  </h3>
                  <div className="server-confidence">
                    {(
                      [
                        ["known", "알겠어요", "자신 있게 풀었어요"],
                        ["unsure", "헷갈려요", "조금 더 생각해 볼래요"],
                        ["unknown", "모르겠어요", "설명이 필요해요"],
                      ] as const
                    ).map(([id, title, desc]) => (
                      <button
                        key={id}
                        className={confidence === id ? "selected" : ""}
                        aria-pressed={confidence === id}
                        onClick={() => setConfidence(id)}
                        disabled={busy}
                      >
                        <strong>{title}</strong>
                        <small>{desc}</small>
                      </button>
                    ))}
                  </div>
                  <button
                    className="primary-button full-width"
                    disabled={
                      choice === null ||
                      choice === "" ||
                      !confidence ||
                      busy ||
                      !opened
                    }
                    onClick={() => void submit()}
                  >
                    {busy ? "답안을 저장하고 있어요" : "정답 확인"}
                  </button>
                  <p className="muted small center">
                    빠르게 맞히는 것보다 솔직한 이해도가 중요해요.
                  </p>
                </>
              ) : (
                <div className="server-feedback" aria-live="polite">
                  <span className="tag">
                    {result.correct ? "정답이에요" : "함께 다시 살펴봐요"} · +
                    {result.points}P
                  </span>
                  <h3>
                    정답: {answerLabel(result.correctAnswer, result.choices)}
                  </h3>
                  <p data-localize="off">{result.explanation}</p>
                  <p className="muted small">
                    {assignment.mode !== "practice"
                      ? `다음 복습: ${result.dueDate}`
                      : "다시 풀기는 복습 일정과 포인트를 바꾸지 않아요."}
                  </p>
                  <div className="workspace-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void accountRequest("/api/learn", "POST", {
                          action: "note",
                          id: result.id,
                          reason: result.reason,
                          bookmarked: !result.bookmarked,
                        })
                          .then(() =>
                            setResults((prev) => ({
                              ...prev,
                              [q.id]: {
                                ...result,
                                bookmarked: !result.bookmarked,
                              },
                            })),
                          )
                          .catch((e) => setError(e.message))
                      }
                    >
                      <Bookmark size={16} />
                      {result.bookmarked ? "저장됨" : "오답노트에 저장"}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const reason = window.prompt(
                          "어떤 부분이 잘못되었나요? (최대 500자)",
                        );
                        if (reason)
                          void accountRequest("/api/disputes", "POST", {
                            attemptId: result.id,
                            reason,
                          })
                            .then(() =>
                              setError("문항 검토 요청을 접수했어요."),
                            )
                            .catch((e) => setError(e.message));
                      }}
                    >
                      <Flag size={16} />
                      오류 신고
                    </button>
                    <button className="primary-button" onClick={next}>
                      다음으로
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              )}
              {error && (
                <p className="storage-warning" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </Localize>
  );
}
