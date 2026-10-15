"use client";
import { useState } from "react";
import { CheckCircle2, Sparkles, ChevronRight } from "lucide-react";
import {
  ADAPTIVE_POLICY,
  unitCoverage,
  planFor,
  unitRevision,
  type AdaptiveSnapshot,
} from "@/lib/adaptive-learning";
import type { Book, Unit } from "@/lib/learning";
import { accountRequest } from "./account-provider";
import { SubjectCompanion } from "./adventure";
import { Localize } from "./localize";

export const MASTERY_LABELS = {
  learning: "학습 중",
  "awaiting-check": "다른 날 확인",
  secure: "확인 완료",
  "needs-work": "보강 필요",
};
export function AdaptiveMap({
  books,
  adaptive,
  aiConfigured,
  onChange,
  onExtra,
  onReinforce,
}: {
  books: Book[];
  adaptive: AdaptiveSnapshot;
  aiConfigured: boolean;
  onChange: () => Promise<void>;
  onExtra: (bookId: string, unitId: string) => void;
  onReinforce: (bookId: string, concept: string, skillType: string) => void;
}) {
  return (
    <Localize>
      <div className="workspace-stack adaptive-map">
        <div className="workspace-notice">
          <strong>10문제는 한 회차의 상한이에요.</strong>
          <p>
            등록한 본문을 개념·유형으로 나누고, 서로 다른 새 문제와 다른 날짜의
            풀이로 확인해요. 단원마다 필요한 문제 수는 달라집니다. 확인을 마친
            단원에서 나중에 어려움이 생기면 보강으로 따로 다뤄요.
          </p>
          <p className="small muted">
            {`현재 운영 기준: 서로 다른 문항 ${ADAPTIVE_POLICY.distinct}개 이상 · 최근 ${ADAPTIVE_POLICY.recentCorrect}개 정답과 ‘알겠어요’ · 서로 다른 ${ADAPTIVE_POLICY.successfulDays}일. 학습 효과를 보장하는 고정 기준이 아니며 운영 중 조정할 수 있어요.`}
          </p>
        </div>
        {!books.length && (
          <p className="panel">
            교재를 등록하면 단원별 학습지도를 볼 수 있어요.
          </p>
        )}
        {books.map((book) => (
          <section className="panel workspace-stack" key={book.id}>
            <div className="section-heading">
              <div>
                <SubjectCompanion subject={book.subject} />
                <h2>{book.title}</h2>
              </div>
              <span className="tag">등록한 본문 범위 기준</span>
            </div>
            {book.units.map((unit) => (
              <UnitMap
                key={`${book.id}-${unit.id}-${unitRevision(book, unit)}`}
                book={book}
                unit={unit}
                adaptive={adaptive}
                aiConfigured={aiConfigured}
                onChange={onChange}
                onExtra={onExtra}
                onReinforce={onReinforce}
              />
            ))}
          </section>
        ))}
      </div>
    </Localize>
  );
}
function UnitMap({
  book,
  unit,
  adaptive,
  aiConfigured,
  onChange,
  onExtra,
  onReinforce,
}: {
  book: Book;
  unit: Unit;
  adaptive: AdaptiveSnapshot;
  aiConfigured: boolean;
  onChange: () => Promise<void>;
  onExtra: (bookId: string, unitId: string) => void;
  onReinforce: (bookId: string, concept: string, skillType: string) => void;
}) {
  const coverage = unitCoverage(book, unit, adaptive),
    plan = planFor(book, unit, adaptive);
  const [editing, setEditing] = useState(false),
    [lines, setLines] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await onChange();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="unit-map"
      open={book.units.length === 1 ? true : undefined}
    >
      <summary>
        <span>{unit.title}</span>
        <span className={`tag ${coverage.complete ? "status-completed" : ""}`}>
          {coverage.planned
            ? `진도 확인 ${coverage.confirmed} / ${coverage.total}유형`
            : "학습지도 준비 필요"}
        </span>
      </summary>
      <div className="workspace-stack">
        {plan ? (
          <>
            <p className="small muted">
              {plan.origin === "ai"
                ? "등록 본문에서 AI가 분석한 학습지도"
                : "직접 정한 개념·유형 학습지도"}{" "}
              ·{" "}
              <span>{`초기 문제은행 준비 목표 ${coverage.initialBankTarget}문항`}</span>{" "}
              ·{" "}
              <span>
                필요한 유형만 나누어 생성합니다. 전부 풀어야 하는 의무량이
                아닙니다.
              </span>
            </p>
            <div className="skill-rows">
              {coverage.rows.map((row) => (
                <div
                  className="skill-row"
                  key={JSON.stringify([row.concept, row.type])}
                >
                  <div>
                    <strong data-localize="off">{row.concept}</strong>
                    <p data-localize="off">{row.type}</p>
                    <small className="muted">
                      {`다른 문항 ${new Set(row.progress?.evidence.map((e) => e.fingerprint) ?? []).size}개 · 풀이 ${row.progress?.attempts ?? 0}회`}
                    </small>
                  </div>
                  <div>
                    <span
                      className={`tag mastery-${row.progress?.status ?? "learning"}`}
                    >
                      {row.progress?.firstSecuredAt && (
                        <CheckCircle2 size={13} />
                      )}
                      {MASTERY_LABELS[row.progress?.status ?? "learning"]}
                    </span>
                    {row.progress?.status === "needs-work" && (
                      <button
                        className="text-button"
                        disabled={busy || !book.active}
                        onClick={() =>
                          onReinforce(book.id, row.concept, row.type)
                        }
                      >
                        새 문제로 보강
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            {unit.source
              ? "본문을 분석해 필요한 개념과 유형을 정한 뒤, 부족한 유형부터 문제를 준비해요."
              : "목차만으로 세부 내용을 추측하지 않아요. 목차·본문·범위 편집에서 이 단원의 본문이나 학습 노트를 등록해 주세요."}
          </p>
        )}
        {editing && (
          <form
            className="workspace-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const skills = lines
                  .split("\n")
                  .filter((l) => l.trim())
                  .map((line) => {
                    const parts = line.split("|");
                    if (parts.length !== 2)
                      throw Error(
                        "각 줄을 ‘개념 | 유형’ 형식으로 입력해 주세요.",
                      );
                    return {
                      concept: parts[0].trim(),
                      type: parts[1].trim(),
                    };
                  });
                await accountRequest("/api/adaptive", "POST", {
                  bookId: book.id,
                  unitId: unit.id,
                  revision: book.revision,
                  skills,
                });
                setEditing(false);
                setMessage(
                  "학습지도를 저장했어요. 변경한 유형에는 새 문항이 필요할 수 있어요.",
                );
              });
            }}
          >
            <label>
              한 줄에 개념 | 유형
              <textarea
                rows={5}
                value={lines}
                maxLength={5000}
                onChange={(e) => setLines(e.target.value)}
              />
            </label>
            <p className="small muted">
              기존 풀이 이력은 보존됩니다. 이름을 바꾼 유형은 새로운 확인
              대상으로 취급해요.
            </p>
            <button className="primary-button" disabled={busy}>
              학습지도 저장
            </button>
          </form>
        )}
        <div className="workspace-actions">
          <button
            className="primary-button"
            disabled={
              busy ||
              !book.active ||
              (!unit.source && !plan && !book.id.startsWith("foundation-"))
            }
            onClick={() => onExtra(book.id, unit.id)}
          >
            이 단원 새 문제 풀기
          </button>
          <button
            className="secondary-button"
            disabled={busy || !unit.source || !aiConfigured}
            onClick={() =>
              void act(async () => {
                await accountRequest("/api/jobs", "POST", {
                  bookId: book.id,
                  unitId: unit.id,
                });
                setMessage(
                  "학습지도와 부족한 유형의 문제를 준비하고 있어요. 출제 작업에서 결과를 확인해 주세요.",
                );
              })
            }
          >
            <Sparkles size={15} />
            {plan ? "부족한 문제 준비" : "학습지도 분석·출제"}
          </button>
          {(plan || unit.source || book.id.startsWith("foundation-")) && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setLines(
                  (
                    plan?.skills ??
                    unit.concepts.map((concept) => ({
                      concept,
                      type: "기본 확인",
                    }))
                  )
                    .map((s) => `${s.concept} | ${s.type}`)
                    .join("\n"),
                );
                setEditing(!editing);
              }}
            >
              {editing
                ? "수정 닫기"
                : plan
                  ? "개념·유형 수정"
                  : "직접 개념·유형 정하기"}
            </button>
          )}
        </div>
        {message && (
          <p className="workspace-notice" role="status">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
