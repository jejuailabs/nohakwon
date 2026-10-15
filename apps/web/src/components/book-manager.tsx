"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import { useEffect, useState } from "react";
import {
  BookOpen,
  FileText,
  Plus,
  Upload,
  Check,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { SUBJECT_NAMES, type Book, type Unit, type Job } from "@/lib/learning";
import { suggestedBooks } from "@/lib/matching";
import { accountRequest, useAccount } from "./account-provider";
import { TextbookFinder } from "./textbook-finder";
import { gradeLabel, schoolLevelOf } from "@/lib/education";
import { SchoolGradeFields } from "./school-grade-fields";
import {
  AdventureHeader,
  AdventureEmpty,
  SubjectCompanion,
  companionStyle,
} from "./adventure";
import { AdaptiveMap } from "./adaptive-map";
import type { AdaptiveSnapshot } from "@/lib/adaptive-learning";

type Props = {
  books: Book[];
  jobs: Job[];
  aiConfigured: boolean;
  onChange: () => Promise<void>;
  onStudy: (bookId: string) => void;
  adaptive: AdaptiveSnapshot;
  onExtra: (bookId: string, unitId: string) => void;
  onReinforce: (bookId: string, concept: string, skillType: string) => void;
};
type Draft = Omit<Book, "id" | "createdAt" | "revision" | "origin">;
const blank: Draft = {
  title: "",
  publisher: "직접 등록",
  grade: 1,
  subject: "math",
  units: [{ id: "unit-1", title: "", concepts: [], source: "" }],
  currentUnit: "unit-1",
  endUnit: "unit-1",
  active: true,
};
export function BookManager({
  books,
  jobs,
  aiConfigured,
  onChange,
  onStudy,
  adaptive,
  onExtra,
  onReinforce,
}: Props) {
  const { profile } = useAccount();
  const blankForLearner = (): Draft => ({
    ...structuredClone(blank),
    schoolLevel: schoolLevelOf(profile),
    grade: profile?.grade ?? 1,
  });
  const [catalog, setCatalog] = useState<Book[]>([]),
    [catalogLoading, setCatalogLoading] = useState(true),
    [draft, setDraft] = useState<Draft | null>(null),
    [editing, setEditing] = useState(""),
    [catalogId, setCatalogId] = useState(""),
    [tab, setTab] = useState<"mine" | "catalog" | "upload" | "map">(
      typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("tab") === "map"
        ? "map"
        : books.length
          ? "mine"
          : "catalog",
    ),
    [input, setInput] = useState(""),
    [kind, setKind] = useState("content"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    accountRequest<{ catalog: Book[] }>("/api/books")
      .then((r) => setCatalog(r.catalog))
      .catch((e) => setError(e.message))
      .finally(() => setCatalogLoading(false));
  }, []);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "작업을 완료하지 못했어요.");
    } finally {
      setBusy("");
    }
  }
  function applyExtraction(
    result: Draft & { warning?: string },
    target?: number,
  ) {
    if (target !== undefined && draft) {
      const source = result.units
        .map((u) => [u.title, u.source].filter(Boolean).join("\n"))
        .join("\n\n");
      editUnit(target, { source });
      setNotice(
        result.warning ||
          "본문을 인식했어요. 내용과 수식을 확인한 뒤 저장해 주세요.",
      );
    } else {
      setCatalogId("");
      setEditing("");
      setDraft({
        ...result,
        active: true,
        currentUnit: result.units[0].id,
        endUnit: result.units[0].id,
      });
      setNotice(
        result.warning ||
          "인식 결과를 확인하고 단원 순서·개념을 수정한 뒤 저장해 주세요.",
      );
    }
  }
  async function upload(file: File, target?: number) {
    await action(
      "자료를 읽고 있어요. 분량에 따라 1~2분 걸릴 수 있어요.",
      async () => {
        const body = new FormData();
        body.set("file", file);
        body.set("kind", target !== undefined ? "content" : kind);
        const r = await fetch("/api/materials", {
          method: "POST",
          body,
          headers: { "X-NoHakwon-Client": "web" },
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        applyExtraction(result, target);
      },
    );
  }
  function editUnit(index: number, patch: Partial<Unit>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            units: d.units.map((u, i) =>
              i === index ? { ...u, ...patch } : u,
            ),
          }
        : null,
    );
  }
  async function save() {
    if (!draft) return;
    await action("교재를 저장하고 있어요", async () => {
      await accountRequest("/api/books", "POST", {
        book: draft,
        ...(editing ? { id: editing } : {}),
        ...(catalogId
          ? {
              catalogId,
              selection: {
                grade: draft.grade,
                currentUnit: draft.currentUnit,
                endUnit: draft.endUnit,
              },
            }
          : {}),
      });
      await onChange();
      setDraft(null);
      setCatalogId("");
      setTab("mine");
      setNotice("교재와 단원·학습 범위를 저장했어요.");
    });
  }
  function selectCatalog(book: Book) {
    setDraft(structuredClone(book));
    setCatalogId(book.id);
    setEditing("");
    setNotice(
      "교과서 목차를 불러왔어요. 현재 배우는 시작 단원과 학습 종료 단원을 선택해 등록하세요.",
    );
  }
  return (
    <Localize>
      <div className="workspace-stack">
        <AdventureHeader
          chapter="books"
          actions={
            <button
              className="primary-button"
              onClick={() => {
                setEditing("");
                setCatalogId("");
                setDraft(blankForLearner());
                setNotice("");
              }}
            >
              <Plus size={18} />
              직접 등록
            </button>
          }
        >
          <span className="tag">{`등록한 교재 ${books.length}권`}</span>
          <span className="tag">
            {`학습 중 ${books.filter((b) => b.active).length}권`}
          </span>
        </AdventureHeader>
        <div className="workspace-tabs">
          {(
            [
              ["mine", "등록한 교재"],
              ["catalog", "교재 찾기"],
              ["upload", "학습 자료 올리기"],
              ["map", "개념·유형 학습지도"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <div className="storage-warning" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="workspace-notice" role="status">
            {notice}
          </p>
        )}
        {busy && (
          <div className="workspace-notice" role="status">
            <span className="loading-dot" /> {busy}
          </div>
        )}
        {!draft && tab === "map" && (
          <AdaptiveMap
            books={books}
            adaptive={adaptive}
            aiConfigured={aiConfigured}
            onChange={onChange}
            onExtra={onExtra}
            onReinforce={onReinforce}
          />
        )}
        {!draft && tab === "mine" && (
          <div className="book-grid">
            {!books.length && (
              <AdventureEmpty
                subject="korean"
                title="첫 교재를 등록해 볼까요?"
                description="표지 사진이나 교재명으로 찾으면 단원 목록을 불러올 수 있어요."
              >
                <button
                  className="primary-button"
                  onClick={() => setTab("catalog")}
                >
                  내 교과서 찾기
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setTab("catalog")}
                >
                  교과서·기초 교재 보기
                </button>
              </AdventureEmpty>
            )}
            {books.map((book) => (
              <article
                className={`panel book-card ${!book.active ? "inactive" : ""}`}
                key={book.id}
                style={companionStyle(book.subject)}
              >
                <SubjectCompanion subject={book.subject} />
                <span className="tag">
                  {gradeLabel(book, true)} · {SUBJECT_NAMES[book.subject]} ·{" "}
                  {book.active ? "학습 중" : "보관 중"}
                </span>
                <h2>{book.title}</h2>
                <p className="muted small">{book.publisher}</p>
                <p>
                  {book.units.find((u) => u.id === book.currentUnit)?.title}{" "}
                  <ArrowRight size={14} />{" "}
                  {book.units.find((u) => u.id === book.endUnit)?.title}
                </p>
                <ol className="book-units">
                  {book.units.map((unit) => (
                    <li key={unit.id}>
                      <span>{unit.title}</span>
                      <small>
                        {unit.source ? "본문 등록됨" : "목차만 등록됨"}
                      </small>
                      {unit.source && (
                        <button
                          disabled={!!busy || !aiConfigured}
                          onClick={() =>
                            void action(
                              "출제 작업을 등록하고 있어요",
                              async () => {
                                await accountRequest("/api/jobs", "POST", {
                                  bookId: book.id,
                                  unitId: unit.id,
                                });
                                await onChange();
                                setNotice(
                                  "AI 출제를 시작했어요. 아래 작업 목록에서 결과를 확인할 수 있어요.",
                                );
                              },
                            )
                          }
                        >
                          <Sparkles size={13} />
                          출제
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="workspace-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setDraft(structuredClone(book));
                      setEditing(book.id);
                      setCatalogId("");
                      setNotice("");
                    }}
                  >
                    목차·본문·범위 편집
                  </button>
                  <button
                    className="primary-button"
                    disabled={!book.active}
                    onClick={() => onStudy(book.id)}
                  >
                    학습하기
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {!draft && tab === "catalog" && catalogLoading && (
          <div className="panel workspace-notice" role="status">
            교과서 목차를 불러오고 있어요.
          </div>
        )}
        {!draft && tab === "catalog" && !catalogLoading && (
          <TextbookFinder
            catalog={catalog}
            registered={books.map((b) => b.id)}
            aiConfigured={aiConfigured}
            onSelect={selectCatalog}
            learnerGrade={profile?.grade ?? 1}
            onAdded={async (added, warning) => {
              await onChange();
              setTab("mine");
              setNotice(
                [
                  added
                    ? `${added}권의 교과서와 목차를 추가했어요.`
                    : "이미 등록한 교과서를 확인했어요.",
                  warning,
                ]
                  .filter(Boolean)
                  .join(" "),
              );
            }}
            initialSchoolLevel={schoolLevelOf(profile)}
          />
        )}
        {!draft && tab === "upload" && (
          <div className="panel material-panel">
            <h2>
              <Upload size={21} /> 내 교재 가져오기
            </h2>
            <p className="muted">
              교과서는 ‘교재 찾기’에서 표지나 이름으로 등록하세요. 이곳에서는
              수업 필기·본문·직접 만든 학습 자료를 추가할 수 있어요.
            </p>
            <label>
              올릴 학습 자료
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="content">단원 본문·학습 노트</option>
                <option value="toc">직접 만든 자료의 목차</option>
              </select>
            </label>
            <label className="upload-area">
              <Upload size={26} />
              <strong>사진·PDF·TXT 파일 선택</strong>
              <span>5MB 이하 · PDF는 한 단원씩 · PNG / JPG / WebP</span>
              <input
                aria-label="교재 파일"
                type="file"
                accept=".pdf,.txt,image/png,image/jpeg,image/webp"
                disabled={!!busy || !aiConfigured}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              텍스트 붙여넣기
              <textarea
                rows={7}
                value={input}
                maxLength={30000}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  "예: 중1 수학\n1. 소인수분해\n2. 정수와 유리수\n3. 문자와 식\n\n본문 자료도 함께 넣을 수 있어요."
                }
              />
            </label>
            <div className="workspace-actions">
              <button
                className="primary-button"
                disabled={!!busy || !input.trim() || !aiConfigured}
                onClick={() =>
                  void action("텍스트에서 단원을 인식하고 있어요", async () =>
                    applyExtraction(
                      await accountRequest("/api/materials", "POST", {
                        text: input,
                        kind,
                      }),
                    ),
                  )
                }
              >
                <Sparkles size={17} />
                AI로 자료 인식
              </button>
              <button
                className="secondary-button"
                disabled={!input.trim() || !!busy}
                onClick={() => {
                  const units = input
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 60)
                    .map((title, i) => ({
                      id: `unit-${i + 1}`,
                      title: title.slice(0, 120),
                      concepts: [title.slice(0, 80)],
                      source: "",
                    }));
                  setDraft({
                    ...blankForLearner(),
                    units,
                    currentUnit: units[0].id,
                    endUnit: units[0].id,
                  });
                  setEditing("");
                  setCatalogId("");
                }}
              >
                줄마다 단원으로 직접 입력
              </button>
            </div>
            <small className="muted">
              인식·출제 시 자료가 OpenAI API로 전송됩니다. 필요한 학습 내용만
              올려 주세요. 원본 파일은 서버에 보관하지 않고, 확인한 텍스트만
              계정에 저장합니다.
            </small>
          </div>
        )}
        {draft &&
          !catalogId &&
          !editing &&
          suggestedBooks(draft, catalog).length > 0 && (
            <section className="panel">
              <h2>비슷한 등록 교재가 있어요</h2>
              <p className="muted small">
                목차·제목 기준 추천입니다. 출판사와 판본을 직접 확인해 주세요.
              </p>
              {suggestedBooks(draft, catalog).map((m) => (
                <p key={m.book.id}>
                  {m.book.title} · {m.book.publisher} · {m.score}% 일치
                  <button
                    className="secondary-button"
                    onClick={() => selectCatalog(m.book)}
                  >
                    이 교과서 목차 불러오기
                  </button>
                </p>
              ))}
            </section>
          )}
        {draft && (
          <section className="panel book-editor">
            <div className="section-heading">
              <h2>
                <FileText size={20} />{" "}
                {catalogId
                  ? "교과서·학습 범위 확인"
                  : editing
                    ? "교재 편집"
                    : "인식 결과 확인·교재 등록"}
              </h2>
              <button
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                편집 닫기
              </button>
            </div>
            <div className="form-grid">
              <label>
                교재명
                <input
                  value={draft.title}
                  readOnly={!!catalogId}
                  maxLength={120}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                출판사·자료 출처
                <input
                  value={draft.publisher}
                  readOnly={!!catalogId}
                  maxLength={80}
                  onChange={(e) =>
                    setDraft({ ...draft, publisher: e.target.value })
                  }
                />
              </label>
              <label>
                판본·교육과정
                <input
                  value={draft.edition ?? ""}
                  readOnly={!!catalogId}
                  maxLength={100}
                  onChange={(e) =>
                    setDraft({ ...draft, edition: e.target.value })
                  }
                  placeholder="예: 2022 개정 / 2025년판"
                />
              </label>
              <label>
                과목
                <select
                  value={draft.subject}
                  disabled={!!catalogId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      subject: e.target.value as Book["subject"],
                    })
                  }
                >
                  {Object.entries(SUBJECT_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <SchoolGradeFields
                value={{
                  schoolLevel: schoolLevelOf(draft),
                  grade: draft.grade,
                }}
                onChange={(v) => setDraft({ ...draft, ...v })}
                levelDisabled={!!catalogId}
                gradeDisabled={!!catalogId && !draft.flexibleGrade}
                prefix="교재 "
              />
              <label>
                현재 시작 단원
                <select
                  value={draft.currentUnit}
                  onChange={(e) => {
                    const start = e.target.value;
                    setDraft({
                      ...draft,
                      currentUnit: start,
                      endUnit:
                        draft.units.findIndex((u) => u.id === draft.endUnit) <
                        draft.units.findIndex((u) => u.id === start)
                          ? start
                          : draft.endUnit,
                    });
                  }}
                >
                  {draft.units.map((u, i) => (
                    <option key={u.id} value={u.id}>
                      {i + 1}. {u.title || "단원명 입력"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                학습 종료 단원
                <select
                  value={draft.endUnit}
                  onChange={(e) =>
                    setDraft({ ...draft, endUnit: e.target.value })
                  }
                >
                  {draft.units
                    .slice(
                      draft.units.findIndex((u) => u.id === draft.currentUnit),
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.title || "단원명 입력"}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
              />
              이 교재로 학습하기
            </label>
            {catalogId && (
              <div className="workspace-notice">
                <strong>
                  {draft.publisher}
                  {draft.author ? ` · ${draft.author}` : ""} · {draft.edition}
                </strong>
                <p>
                  아래 {draft.units.length}개 단원을 연결합니다. 학교에서 배우는
                  범위만 선택하세요.
                </p>
                <ol>
                  {draft.units.map((u) => (
                    <li key={u.id}>{u.title}</li>
                  ))}
                </ol>
                {draft.flexibleGrade && (
                  <p>사회 교과서는 학교에서 배우는 학년으로 선택해 주세요.</p>
                )}
              </div>
            )}
            {!catalogId && (
              <div className="unit-editors">
                {draft.units.map((unit, i) => (
                  <details
                    key={unit.id}
                    open={draft.units.length === 1 || undefined}
                  >
                    <summary>
                      {i + 1}. {unit.title || "새 단원"}
                      <span>
                        {unit.source
                          ? `${unit.source.length.toLocaleString()}자 본문`
                          : "본문 없음"}
                      </span>
                    </summary>
                    <label>
                      단원 이름
                      <input
                        value={unit.title}
                        maxLength={120}
                        onChange={(e) => editUnit(i, { title: e.target.value })}
                      />
                    </label>
                    <label>
                      핵심 개념 (쉼표로 구분)
                      <input
                        value={unit.concepts.join(", ")}
                        onChange={(e) =>
                          editUnit(i, {
                            concepts: e.target.value
                              .split(",")
                              .map((s) => s.trim()),
                          })
                        }
                      />
                    </label>
                    <label>
                      단원 본문·학습 노트
                      <textarea
                        rows={8}
                        value={unit.source}
                        maxLength={24000}
                        onChange={(e) =>
                          editUnit(i, { source: e.target.value })
                        }
                        placeholder="이 단원의 정의, 설명, 예제, 지문을 넣어 주세요. 이 내용에 근거해 문제를 만듭니다."
                      />
                    </label>
                    <div className="workspace-actions">
                      <label className="secondary-button file-button">
                        <Upload size={15} />
                        본문 사진·PDF 인식
                        <input
                          aria-label={`${unit.title} 본문 파일`}
                          type="file"
                          accept=".pdf,.txt,image/png,image/jpeg,image/webp"
                          disabled={!!busy || !aiConfigured}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void upload(f, i);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        className="secondary-button"
                        disabled={i === 0}
                        onClick={() => {
                          const units = [...draft.units];
                          [units[i - 1], units[i]] = [units[i], units[i - 1]];
                          setDraft({ ...draft, units });
                        }}
                      >
                        위로
                      </button>
                      <button
                        className="text-danger"
                        disabled={draft.units.length === 1}
                        onClick={() => {
                          const units = draft.units.filter(
                            (u) => u.id !== unit.id,
                          );
                          setDraft({
                            ...draft,
                            units,
                            currentUnit: units.some(
                              (u) => u.id === draft.currentUnit,
                            )
                              ? draft.currentUnit
                              : units[0].id,
                            endUnit: units.some((u) => u.id === draft.endUnit)
                              ? draft.endUnit
                              : units.at(-1)!.id,
                          });
                        }}
                      >
                        단원 삭제
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            )}
            <div className="workspace-actions">
              {!catalogId && (
                <button
                  className="secondary-button"
                  disabled={draft.units.length >= 60}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      units: [
                        ...draft.units,
                        {
                          id: `unit-${crypto.randomUUID()}`,
                          title: "",
                          concepts: [],
                          source: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  단원 추가
                </button>
              )}
              <button
                className="primary-button"
                disabled={!!busy}
                onClick={() => void save()}
              >
                <Check size={17} />
                확인하고 저장
              </button>
            </div>
          </section>
        )}
        {jobs.length > 0 && (
          <section className="panel">
            <h2>출제 작업</h2>
            <div className="job-list">
              {jobs.map((job) => (
                <div key={job.id}>
                  <div>
                    <strong>
                      {books
                        .find((b) => b.id === job.bookId)
                        ?.units.find((u) => u.id === job.unitId)?.title ||
                        "단원"}
                    </strong>
                    <p className="muted small">
                      {job.status === "completed"
                        ? `검증 통과 ${job.accepted}문항 · 검수 대기 ${job.rejected}문항`
                        : job.status === "failed"
                          ? job.error
                          : job.status === "running"
                            ? "문제 생성·재검증 중"
                            : "처리 대기 중"}
                    </p>
                  </div>
                  <span className={`tag status-${job.status}`}>
                    {
                      {
                        queued: "대기",
                        running: "진행 중",
                        completed: "완료",
                        failed: "실패",
                      }[job.status]
                    }
                  </span>
                  {job.status === "failed" && (
                    <button
                      disabled={!!busy}
                      className="secondary-button"
                      onClick={() =>
                        void action("다시 시도합니다", async () => {
                          await accountRequest("/api/jobs", "POST", {
                            retry: job.id,
                          });
                          await onChange();
                        })
                      }
                    >
                      재시도
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Localize>
  );
}
