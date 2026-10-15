"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, Camera, ArrowRight, BookOpen } from "lucide-react";
import { SUBJECT_NAMES, type Book } from "@/lib/learning";
import {
  identityFromText,
  matchTextbooks,
  type TextbookIdentity,
} from "@/lib/matching";
import type { TextbookPhotoResult } from "@/lib/textbook-recognition";
import { TextbookPhotoResults } from "./textbook-photo-results";
import { accountRequest } from "./account-provider";
import {
  gradeLabel,
  schoolLevelOf,
  SCHOOL_GRADES,
  SCHOOL_NAMES,
  type SchoolLevel,
  type Grade,
} from "@/lib/education";

export function TextbookFinder({
  catalog,
  registered,
  aiConfigured,
  onSelect,
  onAdded,
  learnerGrade = 1,
  initialSchoolLevel = "middle",
}: {
  catalog: Book[];
  registered: string[];
  aiConfigured: boolean;
  onSelect: (book: Book) => void;
  onAdded: (added: number, warning: string) => Promise<void>;
  learnerGrade?: Grade;
  initialSchoolLevel?: SchoolLevel;
}) {
  const [query, setQuery] = useState(""),
    [schoolLevel, setSchoolLevel] = useState<SchoolLevel | "">(
      initialSchoolLevel,
    ),
    [subject, setSubject] = useState(""),
    [grade, setGrade] = useState(""),
    [curriculum, setCurriculum] = useState(""),
    [publisher, setPublisher] = useState("");
  const [recognition, setRecognition] = useState<TextbookPhotoResult | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(
    null,
  );
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  const official = catalog.filter(
    (b) =>
      !b.id.startsWith("foundation-") &&
      (!schoolLevel || schoolLevelOf(b) === schoolLevel),
  );
  const publishers = [
    ...new Set(official.map((b) => b.publisher.split("·")[0].trim())),
  ].sort();
  const results = useMemo(() => {
    const available = catalog.filter(
      (b) =>
        (!schoolLevel || schoolLevelOf(b) === schoolLevel) &&
        (!subject || b.subject === subject) &&
        (!grade || b.flexibleGrade || b.grade === Number(grade)) &&
        (!curriculum ||
          b.curriculum === curriculum ||
          b.edition?.includes(curriculum)) &&
        (!publisher || b.publisher.split("·")[0].trim() === publisher),
    );
    if (query.trim()) return matchTextbooks(identityFromText(query), available);
    return available
      .filter((b) => !b.id.startsWith("foundation-"))
      .map((book) => ({ book, score: 0, reasons: [] }));
  }, [catalog, schoolLevel, subject, grade, curriculum, publisher, query]);
  async function identify(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    setRecognition(null);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error("교과서 사진은 5MB 이하로 올려 주세요.");
      setPhoto({ name: file.name, url: URL.createObjectURL(file) });
      const body = new FormData();
      body.set("kind", "cover");
      body.set("file", file);
      const response = await fetch("/api/materials", {
        method: "POST",
        body,
        headers: { "X-NoHakwon-Client": "web" },
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setRecognition(result as TextbookPhotoResult);
      setSubject("");
      setGrade("");
      setCurriculum("");
      setPublisher("");
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 읽지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  function searchAgain(identity?: TextbookIdentity) {
    setRecognition(null);
    setPhoto(null);
    setQuery(
      identity
        ? [
            identity.publisher,
            identity.title,
            identity.author && `(${identity.author})`,
            identity.curriculum && `${identity.curriculum} 개정`,
          ]
            .filter(Boolean)
            .join(" ")
        : "",
    );
    setSchoolLevel(identity?.schoolLevel || "");
    setSubject("");
    setGrade("");
    setCurriculum("");
    setPublisher("");
  }
  async function requestBook() {
    setBusy(true);
    setError("");
    try {
      await accountRequest("/api/books", "POST", {
        action: "request",
        title: query,
      });
      setNotice(
        "교재 추가 요청을 보냈어요. 운영자가 출판사 자료를 확인해 목록에 등록합니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-stack textbook-finder">
      <div className="panel textbook-search">
        <div>
          <p className="eyebrow">FIND YOUR TEXTBOOK</p>
          <h2>사진 한 장으로, 내 교과서 찾기</h2>
          <p className="muted">
            표지 한 권이나 여러 과목의 교과서 안내표를 올려 주세요. 과목별로
            출판사·저자·개정판을 찾아 목차를 보여 드립니다. 확인 후 버튼으로
            추가하세요.
          </p>
        </div>
        <div className="textbook-search-row">
          <label className="textbook-query">
            <Search size={19} />
            <input
              aria-label="교과서 검색"
              value={query}
              maxLength={200}
              placeholder="예: 비상 수학 1 / 미래엔 국어 1-1 (신유식)"
              onChange={(e) => {
                setQuery(e.target.value);
                const level = identityFromText(e.target.value).schoolLevel;
                if (level && level !== schoolLevel) {
                  setSchoolLevel(level);
                  setGrade("");
                  setPublisher("");
                }
                setRecognition(null);
                setPhoto(null);
                setNotice("");
              }}
            />
          </label>
          <label
            className={`secondary-button file-button ${busy ? "disabled" : ""}`}
          >
            <Camera size={18} />
            {busy ? "교과서를 읽고 있어요…" : "사진·안내표로 찾기"}
            <input
              type="file"
              aria-label="교과서 표지 사진"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || !aiConfigured}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void identify(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <small className="muted">
          표지·교과서 안내표 PNG/JPG/WebP · 5MB 이하 · 사진 한 장에 최대 20권
        </small>
        {!recognition && (
          <>
            <div className="form-grid textbook-filters">
              <label>
                학교급
                <select
                  aria-label="교과서 학교급"
                  value={schoolLevel}
                  onChange={(e) => {
                    setSchoolLevel(e.target.value as SchoolLevel | "");
                    setGrade("");
                    setPublisher("");
                  }}
                >
                  <option value="">전체 학교급</option>
                  <option value="elementary">초등학교 4~6학년</option>
                  <option value="middle">중학교 1~3학년</option>
                </select>
              </label>
              <label>
                과목
                <select
                  aria-label="교과서 과목"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  <option value="">전체 과목</option>
                  {Object.entries(SUBJECT_NAMES).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                학년
                <select
                  aria-label="교과서 학년"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                >
                  <option value="">전체 학년</option>
                  {(schoolLevel
                    ? [schoolLevel]
                    : (["elementary", "middle"] as SchoolLevel[])
                  ).flatMap((level) =>
                    SCHOOL_GRADES[level].map((g) => (
                      <option key={`${level}-${g}`} value={g}>
                        {SCHOOL_NAMES[level]} {g}학년
                      </option>
                    )),
                  )}
                </select>
              </label>
              <label>
                출판사
                <select
                  aria-label="교과서 출판사"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                >
                  <option value="">전체 출판사</option>
                  {publishers.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                교육과정
                <select
                  aria-label="교과서 개정판"
                  value={curriculum}
                  onChange={(e) => setCurriculum(e.target.value)}
                >
                  <option value="">전체 개정판</option>
                  <option value="2022">2022 개정</option>
                  <option value="2015">2015 개정</option>
                </select>
              </label>
            </div>
            <small className="muted">
              현재 {publishers.length}개 출판사 · {official.length}종의 공식
              목차가 등록되어 있어요.{" "}
              {schoolLevel === "elementary"
                ? "초등 교과서는 학기와 권까지 확인해 주세요."
                : "사회 ①·②는 학교 편성에 따라 학년을 선택합니다."}
            </small>
          </>
        )}
        {!aiConfigured && (
          <p className="muted small">
            표지 인식을 준비 중입니다. 교재명 검색과 목록 선택은 사용할 수
            있어요.
          </p>
        )}
        {error && (
          <p role="alert" className="storage-warning">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="workspace-notice">
            {notice}
          </p>
        )}
      </div>
      {recognition ? (
        <TextbookPhotoResults
          photo={photo}
          result={recognition}
          registered={registered}
          learnerGrade={learnerGrade}
          onAdded={onAdded}
          onSearch={searchAgain}
        />
      ) : (
        <>
          <div className="section-heading">
            <h2>교과서 {results.length}종</h2>
            <small className="muted">선택 → 단원·범위 확인 → 등록</small>
          </div>
          {!results.length && (
            <div className="panel empty-state">
              <BookOpen size={30} />
              <h3>아직 일치하는 교과서가 없어요</h3>
              <p className="muted">
                검색어와 필터를 확인해 주세요. 다른 저자나 개정판의 목차를 대신
                연결하지 않습니다.
              </p>
              <button
                className="secondary-button"
                disabled={busy || !query.trim()}
                onClick={() => void requestBook()}
              >
                이 교재 추가 요청
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setQuery("");
                  setRecognition(null);
                  setSubject("");
                  setSchoolLevel("");
                  setGrade("");
                  setPublisher("");
                  setCurriculum("");
                }}
              >
                전체 교과서 보기
              </button>
            </div>
          )}
          <div className="book-grid">
            {results.map(({ book, reasons }) => (
              <article className="panel book-card" key={book.id}>
                <span className="tag">
                  {SUBJECT_NAMES[book.subject]} ·{" "}
                  {book.flexibleGrade
                    ? "중학교 학년 공통"
                    : gradeLabel(book, true)}{" "}
                  · {book.curriculum || book.edition?.match(/2015|2022/)?.[0]}{" "}
                  개정
                </span>
                <h2>{book.title}</h2>
                <p className="muted">
                  {book.publisher}
                  {book.author ? ` · ${book.author}` : ""}
                </p>
                {reasons.length > 0 && (
                  <small className="textbook-reasons">
                    확인된 항목: {reasons.join(" · ")}
                  </small>
                )}
                <details>
                  <summary>등록된 {book.units.length}개 단원 보기</summary>
                  <ol className="book-units">
                    {book.units.map((u) => (
                      <li key={u.id}>{u.title}</li>
                    ))}
                  </ol>
                </details>
                {book.sourceUrl && (
                  <a
                    className="tag"
                    href={book.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    출판사 공식 목차 ↗
                  </a>
                )}
                <button
                  className="primary-button"
                  disabled={busy || registered.includes(book.id)}
                  onClick={() => onSelect(book)}
                >
                  {registered.includes(book.id)
                    ? "등록됨"
                    : "이 교과서 목차 불러오기"}
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
          {!query && (
            <details className="panel">
              <summary>교과서 없이 기초 학습 체험하기</summary>
              <div className="workspace-actions">
                {catalog
                  .filter(
                    (b) =>
                      b.id.startsWith("foundation-") &&
                      (!schoolLevel || schoolLevelOf(b) === schoolLevel),
                  )
                  .map((book) => (
                    <button
                      className="secondary-button"
                      key={book.id}
                      disabled={registered.includes(book.id)}
                      onClick={() => onSelect(book)}
                    >
                      {book.title}
                    </button>
                  ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
