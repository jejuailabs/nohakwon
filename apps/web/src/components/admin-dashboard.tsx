"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";
import { AdminOperations, ConceptEditor } from "./admin-operations";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Download, RefreshCw } from "lucide-react";
import { accountRequest } from "./account-provider";
import {
  answerLabel,
  type BankQuestion,
  type Book,
  type LearningConfig,
  type Job,
} from "@/lib/learning";
type Snapshot = {
  role: string;
  textbooks: Book[];
  students: {
    id: string;
    nickname: string;
    grade: number;
    guardianUid: string;
    paidUntil: string;
    cancelAtPeriodEnd: boolean;
  }[];
  questions: BankQuestion[];
  jobs: Job[];
  disputes: {
    id: string;
    studentId: string;
    questionId: string;
    reason: string;
    status: string;
    resolution?: string;
  }[];
  usage: {
    id: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    at: string;
  }[];
  config: LearningConfig;
  audit: { id: string; action: string; target: string; at: string }[];
  aiConfigured: boolean;
  billingConfigured: boolean;
};
export function AdminDashboard() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("questions"),
    [student, setStudent] = useState(""),
    [editing, setEditing] = useState(""),
    [editId, setEditId] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [roleUid, setRoleUid] = useState(""),
    [role, setRole] = useState("reviewer");
  const load = useCallback(async () => {
    try {
      setData(
        await accountRequest<Snapshot>(
          `/api/admin${student ? `?studentId=${student}` : ""}`,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [student]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(body: unknown) {
    setBusy(true);
    try {
      await accountRequest("/api/admin", "POST", body);
      setEditing("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <PersistedLocale>
      <Localize>
        <div className="app theme-b admin-app">
          <main className="admin-main workspace-stack">
            <div className="workspace-heading">
              <div>
                <p className="eyebrow">NOHAKWON OPERATIONS</p>
                <h1>
                  <ShieldCheck size={26} /> 운영 관리
                </h1>
              </div>
              <div className="workspace-actions">
                <Link className="secondary-button" href="/b">
                  학습 화면
                </Link>
                <button
                  className="secondary-button"
                  onClick={() => void load()}
                >
                  <RefreshCw size={16} />
                  새로고침
                </button>
              </div>
            </div>
            {error && (
              <p className="storage-warning" role="alert">
                {error}
              </p>
            )}
            {!data ? (
              <p>
                관리자 권한을 확인하고 있습니다. 권한이 없다면 학습 화면으로
                돌아가 주세요.
              </p>
            ) : (
              <>
                <div className="report-metrics">
                  <div className="panel">
                    <strong>{data.students.length}</strong>
                    <span>학습 프로필 (최대 100개 조회)</span>
                  </div>
                  <div className="panel">
                    <strong>
                      {data.disputes.filter((d) => d.status === "open").length}
                    </strong>
                    <span>문항 신고 대기</span>
                  </div>
                  <div className="panel">
                    <strong>
                      $
                      {data.usage
                        .reduce((n, u) => n + u.estimatedUsd, 0)
                        .toFixed(4)}
                    </strong>
                    <span>최근 100회 AI 호출 추정 비용</span>
                  </div>
                  <div className="panel">
                    <strong>{data.aiConfigured ? "연결됨" : "미설정"}</strong>
                    <span>AI 출제 서비스</span>
                  </div>
                </div>
                <nav className="workspace-tabs">
                  {[
                    ["questions", "문제 검수"],
                    ["textbooks", "교재 목록"],
                    ["concepts", "성취기준·개념"],
                    ["operations", "리포트·결제"],
                    ["disputes", "신고"],
                    ["usage", "AI 비용·작업"],
                    ["users", "학습자·권한"],
                    ["config", "운영 설정"],
                    ["audit", "관리 기록"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={tab === id ? "active" : ""}
                      onClick={() => {
                        setTab(id);
                        setEditing("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {tab === "concepts" && <ConceptEditor />}
                {tab === "operations" && (
                  <>
                    <label>
                      학습 프로필
                      <select
                        value={student}
                        onChange={(e) => setStudent(e.target.value)}
                      >
                        <option value="">학습자 선택</option>
                        {data.students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nickname}
                          </option>
                        ))}
                      </select>
                    </label>
                    <AdminOperations studentId={student} />
                  </>
                )}
                {tab === "questions" && (
                  <section className="panel">
                    <div className="form-grid">
                      <label>
                        학습 프로필
                        <select
                          value={student}
                          onChange={(e) => setStudent(e.target.value)}
                        >
                          <option value="">공유 문제은행 (등록 교재)</option>
                          {data.students.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.nickname} · 중{s.grade}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        문항 상태
                        <select
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">전체</option>
                          <option value="pending">검수 대기</option>
                          <option value="approved">승인</option>
                          <option value="disabled">비활성</option>
                        </select>
                      </label>
                    </div>
                    <p className="muted small">
                      개인 교재 문제는 해당 학습자만 사용합니다. 관리자의
                      문제은행 조회·편집은 기록됩니다.
                    </p>
                    <div className="admin-toolbar">
                      <button
                        className="primary-button"
                        disabled={!!student || data.role === "reviewer"}
                        onClick={() => {
                          const b = data.textbooks[0];
                          if (!b) return;
                          setEditing(
                            JSON.stringify(
                              {
                                id: crypto.randomUUID(),
                                bookId: b.id,
                                unitId: b.units[0].id,
                                concept: b.units[0].concepts[0],
                                subject: b.subject,
                                grade: b.grade,
                                kind: "mcq",
                                prompt: "",
                                choices: ["", "", "", ""],
                                answer: 0,
                                acceptable: [],
                                explanation: "",
                                evidence: "",
                                difficulty: 2,
                                variant: crypto.randomUUID(),
                                expectedSeconds: 60,
                                status: "pending",
                                origin: "editor",
                              },
                              null,
                              2,
                            ),
                          );
                        }}
                      >
                        새 문항 등록
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          download(data.questions, "question-bank.json")
                        }
                      >
                        <Download size={15} />
                        JSON 내보내기
                      </button>
                    </div>
                    <div className="admin-scroll">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>상태</th>
                            <th>개념·문제</th>
                            <th>정답·난이도</th>
                            <th>검수</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.questions
                            .filter(
                              (q) => filter === "all" || q.status === filter,
                            )
                            .map((q) => (
                              <tr key={q.id}>
                                <td>{q.status}</td>
                                <td>
                                  <b>{q.concept}</b>
                                  <p>{q.prompt}</p>
                                </td>
                                <td>
                                  {answerLabel(q.answer, q.choices)} ·{" "}
                                  {q.difficulty}
                                </td>
                                <td>
                                  <button
                                    className="secondary-button"
                                    onClick={() => {
                                      setEditing(JSON.stringify(q, null, 2));
                                      setEditId(q.id);
                                    }}
                                  >
                                    편집·승인
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {editing && (
                      <div className="workspace-stack">
                        <label>
                          문항 내용 (kind: mcq / short, 객관식 answer: 0~3,
                          단답형 answer: 문자열, acceptable: 허용 답안 배열)
                          <textarea
                            className="admin-json"
                            value={editing}
                            onChange={(e) => setEditing(e.target.value)}
                          />
                        </label>
                        <button
                          className="primary-button"
                          disabled={busy}
                          onClick={() => {
                            try {
                              void save({
                                action: "question",
                                studentId: student,
                                question: JSON.parse(editing),
                              });
                            } catch {
                              setError("JSON 형식을 확인해 주세요.");
                            }
                          }}
                        >
                          검수 내용 저장
                        </button>
                      </div>
                    )}
                  </section>
                )}
                {tab === "textbooks" && (
                  <section className="panel workspace-stack">
                    <h2>등록 교재</h2>
                    <p className="muted">
                      실제 출판사 자료는 확인된 목차만 등록하세요. 공개 목록에는
                      교재 정보만 노출됩니다.
                    </p>
                    <div className="workspace-actions">
                      <button
                        className="primary-button"
                        onClick={() => {
                          setEditId(`book-${crypto.randomUUID()}`);
                          setEditing(
                            JSON.stringify(
                              {
                                title: "",
                                publisher: "",
                                grade: 1,
                                subject: "math",
                                units: [
                                  {
                                    id: "unit-1",
                                    title: "",
                                    concepts: [],
                                    source: "",
                                  },
                                ],
                                currentUnit: "unit-1",
                                endUnit: "unit-1",
                                active: true,
                              },
                              null,
                              2,
                            ),
                          );
                        }}
                      >
                        새 교재
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          download(data.textbooks, "textbooks.json")
                        }
                      >
                        내보내기
                      </button>
                      <label className="secondary-button file-button">
                        JSON 가져오기
                        <input
                          type="file"
                          accept=".json"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f && f.size < 500000) {
                              setEditing(await f.text());
                              setEditId(`book-${crypto.randomUUID()}`);
                            }
                          }}
                        />
                      </label>
                    </div>
                    {data.textbooks.map((b) => (
                      <div className="row-between" key={b.id}>
                        <span>
                          {b.title} · {b.publisher} · v{b.revision}
                        </span>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setEditId(b.id);
                            setEditing(JSON.stringify(b, null, 2));
                          }}
                        >
                          편집
                        </button>
                      </div>
                    ))}
                    {editing && (
                      <>
                        <textarea
                          aria-label="교재 JSON"
                          className="admin-json"
                          value={editing}
                          onChange={(e) => setEditing(e.target.value)}
                        />
                        <button
                          className="primary-button"
                          disabled={busy}
                          onClick={() => {
                            try {
                              void save({
                                action: "textbook",
                                id: editId,
                                book: JSON.parse(editing),
                                published: true,
                              });
                            } catch {
                              setError("JSON 형식을 확인해 주세요.");
                            }
                          }}
                        >
                          저장하고 목록에 공개
                        </button>
                      </>
                    )}
                  </section>
                )}
                {tab === "disputes" && (
                  <div className="workspace-stack">
                    {data.disputes.map((d) => (
                      <article className="panel" key={d.id}>
                        <span className="tag">{d.status}</span>
                        <h2>{d.reason}</h2>
                        <p className="muted small">
                          {d.studentId} / {d.questionId}
                        </p>
                        {d.resolution && <p>{d.resolution}</p>}
                        <div className="workspace-actions">
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setStudent(d.studentId);
                              setTab("questions");
                            }}
                          >
                            해당 문제은행 열기
                          </button>
                          {d.status === "open" && (
                            <button
                              className="primary-button"
                              onClick={() => {
                                const resolution =
                                  window.prompt("검토 결과를 입력하세요");
                                if (resolution)
                                  void save({
                                    action: "dispute",
                                    id: d.id,
                                    resolution,
                                  });
                              }}
                            >
                              검토 완료
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    {!data.disputes.length && <p>접수된 신고가 없습니다.</p>}
                  </div>
                )}
                {tab === "usage" && (
                  <section className="panel admin-scroll">
                    <h2>AI 호출 기록</h2>
                    <p className="muted small">
                      추정 단가는 GPT‑6 Luna 입력 $0.10 / 출력 $0.50, 100만 토큰
                      기준입니다. 다른 모델은 공급자 청구서를 확인하세요.
                    </p>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>시각</th>
                          <th>용도</th>
                          <th>모델</th>
                          <th>입력 / 출력</th>
                          <th>추정 USD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.usage.map((u) => (
                          <tr key={u.id}>
                            <td>{u.at.slice(0, 19)}</td>
                            <td>{u.purpose}</td>
                            <td>{u.model}</td>
                            <td>
                              {u.inputTokens} / {u.outputTokens}
                            </td>
                            <td>
                              {u.model === "gpt-6-luna"
                                ? u.estimatedUsd.toFixed(6)
                                : "단가 미확인"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <h2>선택 학습자 작업</h2>
                    {data.jobs.map((j) => (
                      <p key={j.id}>
                        {j.status} · 승인 {j.accepted} / 대기 {j.rejected} ·{" "}
                        {j.error}
                      </p>
                    ))}
                  </section>
                )}
                {tab === "users" && (
                  <section className="panel workspace-stack">
                    <h2>학습 프로필</h2>
                    <div className="admin-scroll">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>닉네임</th>
                            <th>학년</th>
                            <th>보호자 UID</th>
                            <th>유료 이용 종료</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.students.map((s) => (
                            <tr key={s.id}>
                              <td>{s.nickname}</td>
                              <td>{s.grade}</td>
                              <td>{s.guardianUid}</td>
                              <td>
                                {s.paidUntil || "체험"}
                                {s.cancelAtPeriodEnd ? " · 해지 예약" : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {data.role === "owner" && (
                      <>
                        <h2>관리자 역할 지정</h2>
                        <label>
                          Google 계정 UID
                          <input
                            value={roleUid}
                            onChange={(e) => setRoleUid(e.target.value)}
                          />
                        </label>
                        <label>
                          역할
                          <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                          >
                            {["admin", "editor", "reviewer", "none"].map(
                              (r) => (
                                <option key={r}>{r}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <button
                          className="primary-button"
                          disabled={busy || !roleUid}
                          onClick={() =>
                            void save({ action: "role", uid: roleUid, role })
                          }
                        >
                          역할 저장
                        </button>
                      </>
                    )}
                  </section>
                )}
                {tab === "config" && (
                  <section className="panel workspace-stack">
                    <h2>학습·사용량 설정</h2>
                    <p className="muted">
                      변경 기록을 보존합니다. 구독료 변경은 신규 구독부터
                      적용됩니다.
                    </p>
                    <div className="form-grid">
                      {Object.entries(data.config)
                        .filter(([k]) => k !== "version")
                        .map(([key, value]) => (
                          <label key={key}>
                            {(
                              {
                                dailyPerSubject: "과목별 새 문제 상한",
                                maxDaily: "하루 전체 문제 상한",
                                minRewardSeconds: "보상 최소 풀이 시간(초)",
                                minimumNewPerConcept:
                                  "개념별 진도 최소 새 문제",
                                subscriptionWon: "월 구독료(원)",
                                aiDailyCalls: "계정당 AI 일일 호출 한도",
                              } as Record<string, string>
                            )[key] || key}
                            <input
                              type="number"
                              value={value}
                              onChange={(e) =>
                                setData({
                                  ...data,
                                  config: {
                                    ...data.config,
                                    [key]: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                    </div>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        void save({ action: "config", config: data.config })
                      }
                    >
                      설정 저장
                    </button>
                  </section>
                )}
                {tab === "audit" && (
                  <section className="panel admin-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>시각</th>
                          <th>작업</th>
                          <th>대상</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a) => (
                          <tr key={a.id}>
                            <td>{a.at}</td>
                            <td>{a.action}</td>
                            <td>{a.target}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </Localize>
    </PersistedLocale>
  );
}
