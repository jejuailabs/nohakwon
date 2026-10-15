"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BookOpen,
  Swords,
  Home,
  RotateCcw,
  NotebookPen,
  BarChart3,
  Settings2,
  Users,
  Coins,
  Star,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  Play,
  Plus,
  Download,
  LogOut,
} from "lucide-react";
import { seoulDate, type SubjectId } from "@nohakwon/core";
import { SUBJECTS } from "@/lib/questions";
import {
  SUBJECT_NAMES,
  learningUnit,
  answerLabel,
  COSMETICS,
  type Workspace,
  type LearnMode,
  type Result,
  type Book,
} from "@/lib/learning";
import {
  useAccount,
  accountRequest,
  broadcastAccountChange,
} from "./account-provider";
import { BookManager } from "./book-manager";
import { FamilyLinks } from "./family-links";
import { DeleteAccount } from "./delete-account";
import { SavedReports } from "./saved-reports";
import { ServerStudy, type StudyAssignment } from "./server-study";
import {
  gradeLabel,
  schoolLevelOf,
  type Grade,
  type SchoolLevel,
} from "@/lib/education";
import { SchoolGradeFields } from "./school-grade-fields";
import {
  AdventureHeader,
  AdventureEmpty,
  SubjectCompanion,
  companionStyle,
} from "./adventure";

const NAV = [
  { id: "today", label: "오늘의 학습", Icon: Home },
  { id: "books", label: "나의 교재", Icon: BookOpen },
  { id: "reviews", label: "복습", Icon: RotateCcw },
  { id: "notes", label: "오답노트", Icon: NotebookPen },
  { id: "reports", label: "학습 리포트", Icon: BarChart3 },
  { id: "family", label: "보호자", Icon: Users },
  { id: "settings", label: "설정", Icon: Settings2 },
];
const LABELS = {
  ko: NAV.map((n) => n.label),
  en: ["Today", "My books", "Review", "Notes", "Reports", "Family", "Settings"],
  ja: ["今日の学習", "教材", "復習", "ノート", "レポート", "保護者", "設定"],
  zh: ["今日学习", "我的教材", "复习", "错题本", "学习报告", "家长", "设置"],
};
export function LearningWorkspace() {
  const navigation = useRef<HTMLElement>(null);
  const account = useAccount(),
    [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("today"),
    [subject, setSubject] = useState<SubjectId>("math"),
    [assignment, setAssignment] = useState<StudyAssignment | null>(null),
    [filter, setFilter] = useState("all");
  const refresh = useCallback(async () => {
    try {
      setData(await accountRequest<Workspace>("/api/workspace"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const sync = () => {
      const requested = new URLSearchParams(window.location.search).get("view");
      const v = requested === "records" ? "reports" : requested;
      setView(v && NAV.some((n) => n.id === v) ? v : "today");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [refresh]);
  const pending = data?.jobs.some((j) =>
    ["queued", "running"].includes(j.status),
  );
  const ready = !!data;
  useEffect(() => {
    const revealActive = () => {
      const nav = navigation.current;
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (nav && active)
        nav.scrollTo({
          left:
            active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2,
          behavior: "instant",
        });
    };
    revealActive();
    window.addEventListener("resize", revealActive);
    return () => window.removeEventListener("resize", revealActive);
  }, [view, ready]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), 6000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  function navigate(next: string) {
    setView(next);
    setError("");
    window.history.pushState({}, "", `/b?view=${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start(
    mode: LearnMode = "daily",
    bookId?: string,
    questionId?: string,
  ) {
    await action(async () =>
      setAssignment(
        await accountRequest<StudyAssignment>("/api/learn", "POST", {
          action: "start",
          mode,
          ...(bookId ? { bookId } : {}),
          ...(questionId ? { questionId } : {}),
        }),
      ),
    );
  }
  if (!data)
    return (
      <LocaleProvider locale="ko">
        <Localize>
          <div className="app theme-b account-loading">
            <Swords size={34} />
            <h1>나의 학습 공간을 불러오고 있어요</h1>
            {error && (
              <>
                <p role="alert">{error}</p>
                <button
                  className="primary-button"
                  onClick={() => void refresh()}
                >
                  다시 시도
                </button>
              </>
            )}
          </div>
        </Localize>
      </LocaleProvider>
    );
  const date = seoulDate(),
    today = data.results.filter(
      (r) => r.date === date && r.mode !== "practice",
    ),
    due = Object.values(data.state.concepts).filter((c) => c.dueDate <= date),
    selectedBook = data.books.find((b) => b.active && b.subject === subject),
    remaining = data.state.points - data.state.spent,
    locale = data.state.locale,
    savedNotes = data.results.filter((r) => !r.correct || r.bookmarked),
    visibleNotes = savedNotes.filter(
      (r) => filter === "all" || r.subject === filter,
    );
  return (
    <LocaleProvider locale={data?.state.locale ?? "ko"}>
      <Localize>
        <div
          className={`app theme-b learning-workspace ${account.profile?.calm ? "calm-mode" : ""} workspace-${data.state.theme}`}
        >
          <a className="skip-link" href="#main">
            본문으로 이동
          </a>
          <header className="topbar">
            <Link className="brand" href="/b">
              <Swords size={29} />
              <span data-localize="off">
                nohakwon<small>노학원</small>
              </span>
            </Link>
            <div className="header-actions">
              <span className="balance">
                <Coins size={17} />
                {remaining.toLocaleString()} P
              </span>
              <span className="tag">
                {data.entitlement.status === "trial"
                  ? `체험 ${data.entitlement.daysLeft}일 남음`
                  : data.entitlement.status === "active"
                    ? data.entitlement.test
                      ? "테스트 구독"
                      : "구독 중"
                    : "체험 종료"}
              </span>
              <button
                className="profile-button"
                aria-label="학습 프로필 관리"
                onClick={() => navigate("family")}
              >
                <span className="avatar">
                  <Star size={21} />
                </span>
                <span>
                  <strong>{account.profile?.nickname}</strong>
                  <small>
                    <span>
                      {account.profile
                        ? gradeLabel(account.profile)
                        : "학습 프로필"}
                    </span>{" "}
                    · Lv. {1 + Math.floor(data.results.length / 10)}
                  </small>
                </span>
              </button>
            </div>
          </header>
          <nav ref={navigation} className="workspace-nav" aria-label="주 메뉴">
            {NAV.map((n, i) => (
              <button
                className={view === n.id ? "active" : ""}
                aria-current={view === n.id ? "page" : undefined}
                key={n.id}
                onClick={() => navigate(n.id)}
              >
                <n.Icon size={18} />
                {LABELS[locale][i]}
                {n.id === "reviews" && due.length > 0 && (
                  <span>{due.length}</span>
                )}
              </button>
            ))}
            {data.admin && (
              <Link href="/admin">
                <ShieldCheck size={18} />
                관리자
              </Link>
            )}
          </nav>
          <main id="main" className="main-content workspace-main">
            {data.entitlement.status === "trial" &&
              data.entitlement.daysLeft <= 1 && (
                <div className="workspace-notice">
                  체험 마지막 날이에요. 주간 평가와 리포트로 배운 내용을 확인해
                  보세요.
                  <button
                    className="secondary-button"
                    onClick={() => void start("assessment")}
                  >
                    체험 마무리 평가
                  </button>
                </div>
              )}
            {error && (
              <div className="storage-warning" role="alert">
                {error}
                <button
                  className="icon-button"
                  aria-label="알림 닫기"
                  onClick={() => setError("")}
                >
                  ×
                </button>
              </div>
            )}
            {busy && (
              <div className="workspace-notice" role="status">
                요청을 처리하고 있어요…
              </div>
            )}
            {view === "today" && (
              <>
                <div className="workspace-heading">
                  <div>
                    <p className="eyebrow">YOUR DAILY ADVENTURE</p>
                    <h1>
                      {account.profile?.nickname}님, 오늘은 어디까지 가볼까요?
                    </h1>
                    <p className="muted">작은 배움이 쌓여, 더 단단한 나로.</p>
                  </div>
                  <span className="tag">
                    <ShieldCheck size={14} /> 계정에 자동 저장
                  </span>
                </div>
                <section className="party-banner">
                  <div className="party-intro">
                    <span className="season-label">LEARNING ADVENTURE</span>
                    <h2>
                      나의 교재로,
                      <br />
                      <em>나만의 퀘스트.</em>
                    </h2>
                    <p>
                      지금 배우는 단원에서
                      <br />한 문제씩 시작해요.
                    </p>
                  </div>
                  <div className="character-cards">
                    {SUBJECTS.map((s, i) => (
                      <button
                        key={s.id}
                        className={`character-card ${subject === s.id ? "selected" : ""}`}
                        style={
                          {
                            "--character-color": s.color,
                            "--character-position": `${i * 25}%`,
                          } as CSSProperties
                        }
                        onClick={() => setSubject(s.id)}
                        aria-pressed={subject === s.id}
                      >
                        <span className="character-image" />
                        <span className="character-top">✦ LEARNER</span>
                        <span className="character-caption">
                          <small>{s.title}</small>
                          <strong>{s.name}</strong>
                          <span>{s.role}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="party-motto">
                    <span className="orbit-star">✦</span>
                    <p>
                      어제의 발견이
                      <br />
                      <strong>오늘의 자신감으로.</strong>
                    </p>
                  </div>
                </section>
                <div className="workspace-dashboard">
                  <div className="workspace-stack">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>오늘의 학습</h2>
                        <span className="tag">{`${today.length}문제 완료`}</span>
                      </div>
                      <div className="subject-rings">
                        {SUBJECTS.map((s) => {
                          const n = today.filter(
                            (r) => r.subject === s.id,
                          ).length;
                          return (
                            <button
                              key={s.id}
                              onClick={() => setSubject(s.id)}
                              className={s.id === subject ? "active" : ""}
                            >
                              <span
                                className="ring"
                                style={
                                  {
                                    "--ring-color": s.color,
                                    "--percent": `${Math.min(100, (n / data.state.dailyTarget) * 100)}%`,
                                  } as CSSProperties
                                }
                              >
                                <span>
                                  <BookOpen size={18} />
                                </span>
                              </span>
                              <strong>{s.name}</strong>
                              <small>
                                {n} / {data.state.dailyTarget}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                      <p className="muted small">
                        등록한 교재의 선택 범위에서 출제합니다. 문제 수는 검증된
                        문항 수에 따라 달라집니다.
                      </p>
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>기억 다지기</h2>
                        <RotateCcw size={20} />
                      </div>
                      <strong className="metric-number">
                        {due.length}
                        <small>개 개념</small>
                      </strong>
                      <p className="muted">
                        이해도와 정답 기록에 따라 복습 시점을 정했어요.
                      </p>
                      <button
                        className="secondary-button full-width"
                        disabled={!due.length || busy}
                        onClick={() => void start("review")}
                      >
                        복습 시작
                        <ChevronRight size={17} />
                      </button>
                    </section>
                  </div>
                  <section className="panel current-quest">
                    <span className="eyebrow">CURRENT QUEST</span>
                    <h2>{SUBJECT_NAMES[subject]} · 오늘의 도전</h2>
                    {selectedBook ? (
                      <>
                        <span className="tag">{selectedBook.title}</span>
                        <h3>
                          {
                            learningUnit(
                              selectedBook,
                              data.state,
                              data.config.minimumNewPerConcept,
                            )?.title
                          }
                        </h3>
                        <p className="muted">
                          {learningUnit(
                            selectedBook,
                            data.state,
                            data.config.minimumNewPerConcept,
                          )?.concepts.join(" · ")}
                        </p>
                        <div className="quest-orb">
                          <BookOpen size={54} />
                          <span>✦</span>
                        </div>
                        <button
                          className="primary-button full-width"
                          disabled={busy}
                          onClick={() => void start("daily", selectedBook.id)}
                        >
                          <Play size={17} />
                          {today.some((r) => r.bookId === selectedBook.id)
                            ? "이어서 학습하기"
                            : "학습 시작하기"}
                        </button>
                        <button
                          className="secondary-button full-width"
                          onClick={() => navigate("books")}
                        >
                          교재·학습 범위 바꾸기
                        </button>
                      </>
                    ) : (
                      <div className="empty-state">
                        <BookOpen size={42} />
                        <h3>배울 교재를 선택해 주세요</h3>
                        <p>
                          사진이나 교재명으로 내 교과서를 찾으면
                          <br />
                          목차를 불러와 학습할 수 있어요.
                        </p>
                        <button
                          className="primary-button"
                          onClick={() => navigate("books")}
                        >
                          <Plus size={17} />
                          교재 등록
                        </button>
                      </div>
                    )}
                  </section>
                  <div className="workspace-stack">
                    <section className="panel">
                      <h2>나의 모험 기록</h2>
                      <div className="player-identity">
                        <span className="avatar">
                          <Star size={27} />
                        </span>
                        <div>
                          <strong>{account.profile?.nickname}</strong>
                          <span>
                            {COSMETICS.find((c) => c.id === data.state.equipped)
                              ?.name || "배움의 모험가"}
                          </span>
                        </div>
                      </div>
                      <div className="workspace-metrics">
                        <div>
                          <strong>{data.results.length}</strong>
                          <span>학습 문항</span>
                        </div>
                        <div>
                          <strong>{data.report.accuracy}%</strong>
                          <span>최근 7일 정답률</span>
                        </div>
                        <div>
                          <strong>{data.report.days}</strong>
                          <span>최근 7일 학습일</span>
                        </div>
                      </div>
                      <button
                        className="secondary-button full-width"
                        onClick={() => navigate("reports")}
                      >
                        학습 리포트 보기
                      </button>
                    </section>
                    <section className="panel">
                      <span className="eyebrow">CHECK YOUR GROWTH</span>
                      <h2>배운 내용을 점검해요</h2>
                      <p className="muted">
                        학습한 개념을 바탕으로 과목별 최대 5문제를 풀어요.
                      </p>
                      <button
                        className="primary-button full-width"
                        disabled={!data.results.length || busy}
                        onClick={() => void start("assessment")}
                      >
                        주간 평가 시작
                      </button>
                      <button
                        className="secondary-button full-width"
                        disabled={!data.results.length || busy}
                        onClick={() => void start("exam", selectedBook?.id)}
                      >
                        선택 과목 범위 평가
                      </button>
                    </section>
                  </div>
                </div>
              </>
            )}
            {view === "books" && (
              <BookManager
                books={data.books}
                jobs={data.jobs}
                aiConfigured={data.aiConfigured}
                onChange={refresh}
                onStudy={(id) => void start("daily", id)}
              />
            )}
            {view === "reviews" && (
              <div className="workspace-stack">
                <AdventureHeader
                  chapter="reviews"
                  actions={
                    <button
                      className="primary-button"
                      disabled={!due.length || busy}
                      onClick={() => void start("review")}
                    >
                      오늘의 복습 시작
                    </button>
                  }
                >
                  <span className="tag">{`오늘 복습 ${due.length}개 개념`}</span>
                  <span className="tag">
                    {`전체 ${Object.keys(data.state.concepts).length}개 개념`}
                  </span>
                </AdventureHeader>
                <div className="book-grid">
                  {Object.values(data.state.concepts)
                    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                    .map((c) => (
                      <article
                        className="panel review-concept-card"
                        key={c.key}
                        style={companionStyle(c.subject)}
                      >
                        <SubjectCompanion subject={c.subject} />
                        <span className="tag">
                          {SUBJECT_NAMES[c.subject]} ·{" "}
                          {c.dueDate <= date ? "오늘 복습" : "예정"}
                        </span>
                        <h2>{c.concept}</h2>
                        <p className="muted">
                          {data.books.find((b) => b.id === c.bookId)?.title}
                        </p>
                        <p>
                          다음 복습 {c.dueDate} · 간격 {c.interval}일
                        </p>
                        <p className="small muted">
                          최근 정답 {c.history.filter((h) => h.correct).length}{" "}
                          / {c.history.length} · 연속 복습 정답 {c.reviewStreak}
                        </p>
                      </article>
                    ))}
                </div>
                {!Object.keys(data.state.concepts).length && (
                  <AdventureEmpty
                    title="첫 학습을 시작해 주세요"
                    description="답안과 이해도가 쌓이면 개념별 복습 일정이 생겨요."
                  >
                    <button
                      className="primary-button"
                      onClick={() => navigate("today")}
                    >
                      오늘의 학습으로
                    </button>
                  </AdventureEmpty>
                )}
              </div>
            )}
            {view === "notes" && (
              <div className="workspace-stack">
                <AdventureHeader chapter="notes">
                  <span className="tag">{`기록한 문제 ${savedNotes.length}개`}</span>
                </AdventureHeader>
                <div className="notes-toolbar">
                  <p className="muted small">
                    정답과 해설을 다시 읽고, 나만의 풀이 메모를 남겨요.
                  </p>
                  <label>
                    <span className="sr-only">오답 과목</span>
                    <select
                      aria-label="오답 과목"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">모든 과목</option>
                      {Object.entries(SUBJECT_NAMES).map(([id, n]) => (
                        <option key={id} value={id}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {visibleNotes.map((r) => (
                  <NoteCard
                    key={r.id}
                    result={r}
                    book={data.books.find((b) => b.id === r.bookId)}
                    onChange={refresh}
                    onPractice={() =>
                      void start("practice", r.bookId, r.questionId)
                    }
                  />
                ))}
                {!visibleNotes.length && (
                  <AdventureEmpty
                    subject={
                      filter === "all" ? "english" : (filter as SubjectId)
                    }
                    title={
                      savedNotes.length
                        ? "이 과목에 저장한 문제가 없어요"
                        : "아직 오답노트가 비어 있어요"
                    }
                    description="틀린 문제와 저장한 문제가 이곳에 모여요."
                  >
                    <button
                      className="secondary-button"
                      onClick={() =>
                        savedNotes.length ? setFilter("all") : navigate("today")
                      }
                    >
                      {savedNotes.length ? "모든 과목 보기" : "오늘의 학습으로"}
                    </button>
                  </AdventureEmpty>
                )}
              </div>
            )}
            {view === "reports" && (
              <div className="workspace-stack">
                <ReportView
                  data={data}
                  onAssessment={() => void start("assessment")}
                />
                <SavedReports />
              </div>
            )}
            {view === "family" && data.guardian && (
              <FamilyView
                onChange={async () => {
                  await account.refresh();
                  await refresh();
                }}
                data={data}
              />
            )}
            {view === "family" && !data.guardian && (
              <div className="workspace-stack">
                <AdventureHeader chapter="family" />
                <AdventureEmpty
                  subject="science"
                  title="학생 학습 계정"
                  description="결제와 프로필 연결은 보호자 계정에서 관리해 주세요."
                />
              </div>
            )}
            {view === "settings" && (
              <div className="workspace-stack">
                <AdventureHeader chapter="settings">
                  <span className="tag">
                    {`과목별 하루 ${data.state.dailyTarget}문제`}
                  </span>
                  <span className="tag">
                    {account.profile?.calm
                      ? "차분하게 학습 중"
                      : "동료와 함께 학습 중"}
                  </span>
                </AdventureHeader>
                <section className="panel form-grid">
                  <label>
                    화면 테마
                    <select
                      value={data.state.theme}
                      onChange={(e) =>
                        void action(async () => {
                          await accountRequest("/api/learn", "POST", {
                            action: "settings",
                            theme: e.target.value,
                          });
                          await refresh();
                        })
                      }
                    >
                      <option value="dark">다크</option>
                      <option value="light">라이트</option>
                      <option value="system">기기 설정</option>
                    </select>
                  </label>
                  <label>
                    메뉴 언어
                    <select
                      value={locale}
                      onChange={(e) =>
                        void action(async () => {
                          await accountRequest("/api/learn", "POST", {
                            action: "settings",
                            locale: e.target.value,
                          });
                          await refresh();
                        })
                      }
                    >
                      <option value="ko">한국어</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="zh">中文</option>
                    </select>
                  </label>
                  <label>
                    과목별 하루 목표
                    <select
                      value={data.state.dailyTarget}
                      onChange={(e) =>
                        void action(async () => {
                          await accountRequest("/api/learn", "POST", {
                            action: "settings",
                            dailyTarget: Number(e.target.value),
                          });
                          await refresh();
                        })
                      }
                    >
                      {[3, 5, 10].map((n) => (
                        <option key={n} value={n}>{`${n}문제`}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    시작 난이도
                    <select
                      value={data.state.baseDifficulty}
                      onChange={(e) =>
                        void action(async () => {
                          await accountRequest("/api/learn", "POST", {
                            action: "settings",
                            baseDifficulty: Number(e.target.value),
                          });
                          await refresh();
                        })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{`${n}단계`}</option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={data.state.autoDifficulty}
                      onChange={(e) =>
                        void action(async () => {
                          await accountRequest("/api/learn", "POST", {
                            action: "settings",
                            autoDifficulty: e.target.checked,
                          });
                          await refresh();
                        })
                      }
                    />
                    학습 기록에 따라 난이도 자동 조절
                  </label>
                  <label>
                    학교 시험일
                    <input
                      type="date"
                      value={data.state.examDate}
                      onChange={(e) =>
                        void action(async () => {
                          await accountRequest("/api/learn", "POST", {
                            action: "settings",
                            examDate: e.target.value,
                          });
                          await refresh();
                        })
                      }
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      disabled={!data.guardian}
                      checked={account.profile?.calm ?? false}
                      onChange={(e) =>
                        void action(async () => {
                          if (account.profile)
                            await account.saveProfile({
                              nickname: account.profile.nickname,
                              grade: account.profile.grade,
                              schoolLevel: schoolLevelOf(account.profile),
                              calm: e.target.checked,
                            });
                        })
                      }
                    />
                    차분하게 학습하기
                  </label>
                  <p className="muted small">
                    메뉴 언어를 변경해도 교재와 한국 교육과정 문제는 원문 언어를
                    유지합니다.
                  </p>
                </section>
                <section className="panel badge-collection">
                  <span className="eyebrow">ADVENTURER COLLECTION</span>
                  <h2>나만의 배지</h2>
                  <p className="muted">
                    학습 포인트로 모험가 배지를 열어요. 포인트는 현금으로
                    거래되지 않아요.
                  </p>
                  <div className="cosmetic-grid">
                    {COSMETICS.map((c, i) => (
                      <button
                        className={`secondary-button cosmetic-badge ${data.state.equipped === c.id ? "equipped" : ""}`}
                        style={companionStyle(
                          (["math", "science", "english"] as const)[i % 3],
                        )}
                        key={c.id}
                        disabled={busy || data.state.equipped === c.id}
                        onClick={() =>
                          void action(async () => {
                            await accountRequest("/api/learn", "POST", {
                              action: "settings",
                              cosmetic: c.id,
                            });
                            await refresh();
                          })
                        }
                      >
                        <span className="badge-emblem">
                          <Star size={28} />
                        </span>
                        {c.name}
                        <small>
                          {data.state.equipped === c.id
                            ? "사용 중"
                            : data.state.cosmetics.includes(c.id)
                              ? "사용하기"
                              : `${c.price} P`}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel workspace-actions">
                  <Link href="/privacy" className="secondary-button">
                    개인정보 안내
                  </Link>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void action(async () => {
                        const value = await accountRequest("/api/export");
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(value, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "nohakwon-data.json";
                        a.click();
                        URL.revokeObjectURL(url);
                      })
                    }
                  >
                    <Download size={16} />내 데이터 다운로드
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void account.logout()}
                  >
                    <LogOut size={16} />
                    로그아웃
                  </button>
                </section>
                <DeleteAccount />
              </div>
            )}
            <footer className="footer">
              <span>오늘의 작은 배움, 내일의 더 큰 나.</span>
              <span>교재와 학습 기록은 계정에 저장됩니다.</span>
            </footer>
          </main>
          {assignment && (
            <ServerStudy
              assignment={assignment}
              onClose={() => {
                setAssignment(null);
                void refresh();
              }}
              onUpdate={refresh}
            />
          )}
        </div>
      </Localize>
    </LocaleProvider>
  );
}
function NoteCard({
  result: r,
  book,
  onChange,
  onPractice,
}: {
  result: Result;
  book?: Book;
  onChange: () => Promise<void>;
  onPractice: () => void;
}) {
  const [reason, setReason] = useState(r.reason),
    [message, setMessage] = useState("");
  return (
    <Localize>
      <article className="panel note-card" style={companionStyle(r.subject)}>
        <div className="row-between">
          <SubjectCompanion subject={r.subject} detail={r.concept} />
          <span className="muted small">{r.date}</span>
        </div>
        <p className="muted small">
          {book?.title} / {book?.units.find((u) => u.id === r.unitId)?.title}
        </p>
        <h2 data-localize="off">{r.prompt}</h2>
        <p>
          나의 답: {answerLabel(r.answer, r.choices)} · 정답:{" "}
          {answerLabel(r.correctAnswer, r.choices)}
        </p>
        <details>
          <summary>해설 확인</summary>
          <p data-localize="off">{r.explanation}</p>
        </details>
        <label>
          다음에는 이렇게 풀어요
          <textarea
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="개념 / 계산 / 문제 읽기 중 무엇이 어려웠나요?"
          />
        </label>
        <div className="workspace-actions">
          <button
            className="secondary-button"
            onClick={() =>
              void accountRequest("/api/learn", "POST", {
                action: "note",
                id: r.id,
                reason,
                bookmarked: r.bookmarked,
              })
                .then(async () => {
                  setMessage("저장했어요");
                  await onChange();
                })
                .catch((e) => setMessage(e.message))
            }
          >
            메모 저장
          </button>
          <button className="primary-button" onClick={onPractice}>
            다시 풀기
          </button>
          <span role="status" className="muted small">
            {message}
          </span>
        </div>
      </article>
    </Localize>
  );
}
function ReportView({
  data,
  onAssessment,
}: {
  data: Workspace;
  onAssessment: () => void;
}) {
  const report = data.report;
  return (
    <Localize>
      <div className="workspace-stack">
        <AdventureHeader
          chapter="reports"
          actions={
            <button className="secondary-button" onClick={() => window.print()}>
              인쇄·PDF 저장
            </button>
          }
        >
          <span className="tag">{`최근 7일 · ${report.days}일의 발자국`}</span>
        </AdventureHeader>
        <div className="report-metrics">
          {[
            [report.count, "학습 문항"],
            [`${report.accuracy}%`, "정답률"],
            [report.days, "학습한 날"],
            [`${Math.round(report.seconds / 60)}분`, "문제 풀이 시간"],
          ].map(([v, l]) => (
            <div className="panel" key={l}>
              <strong>{v}</strong>
              <span>{l}</span>
            </div>
          ))}
        </div>
        <div className="workspace-two-columns">
          <section className="panel">
            <h2>매일의 발자국</h2>
            <div className="activity-chart">
              {report.daily.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.count}문제, 정답률 ${d.accuracy}%`}
                >
                  <span>{d.count}</span>
                  <i
                    style={{
                      height: `${Math.max(3, (d.count / Math.max(1, ...report.daily.map((d) => d.count))) * 130)}px`,
                    }}
                  />
                  <small>{d.date.slice(5)}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>과목별 학습</h2>
            {report.subjects.map((s) => (
              <div
                className="subject-report"
                key={s.subject}
                style={companionStyle(s.subject)}
              >
                <div className="row-between">
                  <SubjectCompanion subject={s.subject} />
                  <span>
                    {s.count}문제 · {s.accuracy}%
                  </span>
                </div>
                <div className="progress-track">
                  <i style={{ width: `${s.accuracy}%` }} />
                </div>
              </div>
            ))}
          </section>
        </div>
        <section className="panel">
          <h2>다음 한 걸음</h2>
          <p>{report.recommendation}</p>
          {!report.reliable && (
            <p className="muted small">
              아직 표본이 작아 성적 변화나 장기 성취를 판단하지 않습니다.
            </p>
          )}
          <div className="weak-concepts">
            {report.weak.map((c) => (
              <span className="tag" key={c.key}>
                {SUBJECT_NAMES[c.subject]} · {c.concept} · 복습 {c.dueDate}
              </span>
            ))}
          </div>
          <div className="workspace-actions">
            <button
              className="primary-button"
              disabled={!report.count}
              onClick={onAssessment}
            >
              주간 평가로 확인
            </button>
            <span className="muted small">
              알겠어요 {report.confidence.known} · 헷갈려요{" "}
              {report.confidence.unsure} · 모르겠어요{" "}
              {report.confidence.unknown}
            </span>
          </div>
        </section>
      </div>
    </Localize>
  );
}
function FamilyView({
  onChange,
  data,
}: {
  onChange: () => Promise<void>;
  data: Workspace;
}) {
  const account = useAccount(),
    [profiles, setProfiles] = useState<
      {
        id: string;
        nickname: string;
        grade: number;
        schoolLevel?: SchoolLevel;
      }[]
    >([]),
    [nickname, setNickname] = useState(""),
    [schoolLevel, setSchoolLevel] = useState<SchoolLevel>(
      schoolLevelOf(account.profile),
    ),
    [grade, setGrade] = useState<Grade>(account.profile?.grade ?? 1),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    accountRequest<{ profiles: typeof profiles }>("/api/family")
      .then((r) => setProfiles(r.profiles))
      .catch((e) => setMessage(e.message));
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    try {
      await accountRequest("/api/family", "POST", body);
      broadcastAccountChange();
      await onChange();
      const r = await accountRequest<{ profiles: typeof profiles }>(
        "/api/family",
      );
      setProfiles(r.profiles);
      setNickname("");
      setMessage("프로필을 저장했어요.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localize>
      <div className="workspace-stack">
        <AdventureHeader chapter="family">
          {profiles.length > 0 && (
            <span className="tag">{`학습 프로필 ${profiles.length} / 5`}</span>
          )}
        </AdventureHeader>
        <div className="book-grid">
          {profiles.map((p) => (
            <article
              className={`panel family-profile-card ${account.profile?.id === p.id ? "current" : ""}`}
              key={p.id}
            >
              <span className="avatar">
                <Star />
              </span>
              <h2>{p.nickname}</h2>
              <p className="muted">{gradeLabel(p)}</p>
              <button
                className="primary-button"
                disabled={busy || account.profile?.id === p.id}
                onClick={() => void act({ action: "switch", id: p.id })}
              >
                {account.profile?.id === p.id
                  ? "현재 학습 프로필"
                  : "이 프로필로 전환"}
              </button>
            </article>
          ))}
        </div>
        <form
          className="panel form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void act({
              action: "create",
              nickname,
              schoolLevel,
              grade,
              calm: false,
            });
          }}
        >
          <label>
            새 학습자 닉네임
            <input
              required
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <SchoolGradeFields
            value={{ schoolLevel, grade }}
            onChange={(v) => {
              setSchoolLevel(v.schoolLevel);
              setGrade(v.grade);
            }}
            prefix="새 학습자 "
          />
          <button
            className="primary-button"
            disabled={busy || !nickname.trim() || profiles.length >= 5}
          >
            학습 프로필 추가
          </button>
          <p role="status">{message}</p>
        </form>
        <section className="panel">
          <h2>체험·구독</h2>
          <p>
            {data.entitlement.status === "trial"
              ? `무료 체험 종료: ${new Date(data.entitlement.trialEndsAt).toLocaleDateString("ko-KR")}`
              : data.entitlement.status === "active"
                ? `이용 기간: ${new Date(data.entitlement.paidUntil).toLocaleDateString("ko-KR")}까지`
                : "무료 체험이 종료되었습니다."}
          </p>
          <p className="muted">
            학습자 1명당 월 {data.config.subscriptionWon.toLocaleString()}원 ·
            자동 결제는 언제든 해지할 수 있어요.
          </p>
          <Link className="primary-button" href="/billing">
            {data.billingConfigured ? "구독·결제 관리" : "결제 연결 상태 확인"}
          </Link>
        </section>
        <FamilyLinks />
        <Link className="secondary-button" href="/onboarding">
          현재 프로필 닉네임·학년 수정
        </Link>
      </div>
    </Localize>
  );
}
