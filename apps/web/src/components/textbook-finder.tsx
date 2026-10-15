"use client";
import { useMemo, useState } from "react";
import { Search, Camera, ArrowRight, BookOpen } from "lucide-react";
import { SUBJECT_NAMES, type Book } from "@/lib/learning";
import {
  identityFromText,
  matchTextbooks,
  type TextbookIdentity,
  type TextbookMatch,
} from "@/lib/matching";
import { accountRequest } from "./account-provider";

export function TextbookFinder({
  catalog,
  registered,
  aiConfigured,
  onSelect,
}: {
  catalog: Book[];
  registered: string[];
  aiConfigured: boolean;
  onSelect: (book: Book) => void;
}) {
  const [query, setQuery] = useState(""),
    [subject, setSubject] = useState(""),
    [grade, setGrade] = useState(""),
    [curriculum, setCurriculum] = useState(""),
    [publisher, setPublisher] = useState("");
  const [identity, setIdentity] = useState<TextbookIdentity | null>(null),
    [matches, setMatches] = useState<TextbookMatch[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const official = catalog.filter((b) => !b.id.startsWith("foundation-"));
  const publishers = [
    ...new Set(official.map((b) => b.publisher.split("·")[0].trim())),
  ].sort();
  const results = useMemo(() => {
    const available = catalog.filter(
      (b) =>
        (!subject || b.subject === subject) &&
        (!grade || b.flexibleGrade || b.grade === Number(grade)) &&
        (!curriculum ||
          b.curriculum === curriculum ||
          b.edition?.includes(curriculum)) &&
        (!publisher || b.publisher.split("·")[0].trim() === publisher),
    );
    if (matches)
      return matches.filter((m) => available.some((b) => b.id === m.book.id));
    if (query.trim()) return matchTextbooks(identityFromText(query), available);
    return available
      .filter((b) => !b.id.startsWith("foundation-"))
      .map((book) => ({ book, score: 0, reasons: [] }));
  }, [catalog, subject, grade, curriculum, publisher, matches, query]);
  async function identify(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    setIdentity(null);
    setMatches(null);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error("표지 사진은 5MB 이하로 올려 주세요.");
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
      setIdentity(result.identity);
      setMatches(result.matches);
      setSubject("");
      setGrade("");
      setCurriculum("");
      setPublisher("");
      setQuery(
        [
          result.identity.publisher,
          result.identity.title,
          result.identity.author && `(${result.identity.author})`,
          result.identity.curriculum && `${result.identity.curriculum} 개정`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "표지를 읽지 못했어요.");
    } finally {
      setBusy(false);
    }
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
          <h2>표지 한 장이면, 목차는 여기서</h2>
          <p className="muted">
            교과서 이름으로 찾거나 표지를 촬영하세요. 출판사·저자·개정판을
            확인하면 저장된 단원을 바로 불러옵니다.
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
                setIdentity(null);
                setMatches(null);
                setNotice("");
              }}
            />
          </label>
          <label
            className={`secondary-button file-button ${busy ? "disabled" : ""}`}
          >
            <Camera size={18} />
            {busy ? "표지를 읽고 있어요…" : "표지 사진으로 찾기"}
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
        <div className="form-grid textbook-filters">
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
              {[1, 2, 3].map((g) => (
                <option key={g} value={g}>
                  중학교 {g}학년
                </option>
              ))}
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
          현재 {publishers.length}개 출판사 · {official.length}종의 공식 목차가
          등록되어 있어요. 사회 ①·②는 학교 편성에 따라 학년을 선택합니다.
        </small>
        {!aiConfigured && (
          <p className="muted small">
            표지 인식을 준비 중입니다. 교재명 검색과 목록 선택은 사용할 수
            있어요.
          </p>
        )}
        {identity && (
          <div className="workspace-notice">
            <strong>표지에서 읽은 정보</strong>
            <p>
              {[
                identity.title,
                identity.publisher,
                identity.author,
                identity.curriculum && `${identity.curriculum} 개정`,
                identity.volume,
              ]
                .filter(Boolean)
                .join(" · ") ||
                "교재 정보를 읽지 못했어요. 이름으로 검색해 주세요."}
            </p>
            {identity.warning && <p>{identity.warning}</p>}
            <small>아래 후보의 저자·개정판을 확인하고 선택해 주세요.</small>
          </div>
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
              setMatches(null);
              setIdentity(null);
              setSubject("");
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
              {book.flexibleGrade ? "학년 공통" : `중${book.grade}`} ·{" "}
              {book.curriculum || book.edition?.match(/2015|2022/)?.[0]} 개정
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
      {!query && !matches && (
        <details className="panel">
          <summary>교과서 없이 기초 학습 체험하기</summary>
          <div className="workspace-actions">
            {catalog
              .filter((b) => b.id.startsWith("foundation-"))
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
    </section>
  );
}
