"use client";
import { useRef, useState } from "react";
import { ArrowRight, Bookmark, Check, CheckCircle2, CircleHelp, Frown, Smile, Sparkles, Trophy } from "lucide-react";
import { submitAnswer, type Attempt, type Confidence, type Progress, type Question, type StudyMode } from "@nohakwon/core";
import { SUBJECTS } from "@/lib/questions";
import { Modal } from "./modal";

export const CONFIDENCES: { id: Confidence; title: string; description: string; Icon: typeof Smile }[] = [
  { id: "known", title: "알겠어요", description: "스스로 풀 수 있어요", Icon: Smile },
  { id: "unsure", title: "헷갈려요", description: "조금 더 생각해 볼게요", Icon: CircleHelp },
  { id: "unknown", title: "모르겠어요", description: "설명이 필요해요", Icon: Frown },
];

export function StudyDialog({ questions, mode, update, progress, onClose }: {
  questions: Question[]; mode: StudyMode; progress: Progress;
  update: (fn: (p: Progress) => Progress) => Progress; onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);
  const [completed, setCompleted] = useState(false);
  const [results, setResults] = useState<Attempt[]>([]);
  const [error, setError] = useState("");
  const started = useRef(Date.now());
  const pending = useRef(false);
  const q = questions[index];
  const subject = SUBJECTS.find(s => s.id === q.subject)!;
  const bookmarked = progress.bookmarks.includes(q.id);
  function submit() {
    if (answer === null || !confidence || pending.current || result) return;
    pending.current = true;
    try {
      let attempt: Attempt | undefined;
      update(p => {
        const submitted = submitAnswer(p, q, answer, confidence, mode, (Date.now() - started.current) / 1000);
        attempt = submitted.attempt;
        return submitted.progress;
      });
      if (attempt) { setResult(attempt); setAnswer(attempt.answer); setConfidence(attempt.confidence); setResults(previous => [...previous, attempt!]); }
    } catch { setError("답안을 저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { pending.current = false; }
  }
  function next() {
    if (index === questions.length - 1) { setCompleted(true); return; }
    setIndex(i => i + 1); setAnswer(null); setConfidence(null); setResult(null); setError(""); started.current = Date.now();
  }
  return <Modal title={completed ? "오늘도 한 걸음 자랐어요" : mode === "daily" ? `${subject.name} · 오늘의 학습` : mode === "review" ? "기억을 단단하게 · 복습" : "차근차근 · 다시 풀기"} onClose={onClose} className="study-modal">
    {completed ? <div className="completion"><div className="completion-icon"><Trophy size={48} /></div><p className="eyebrow">QUEST COMPLETE</p><h3>{questions.length}문제, 끝까지 해냈어요!</h3><p>오늘의 작은 배움이 내일의 실력이 돼요.</p><div className="completion-stats"><div><strong>{results.filter(r => r.correct).length}<small> / {questions.length}</small></strong><span>맞힌 문제</span></div><div><strong>+{results.reduce((s, r) => s + r.points, 0)}</strong><span>획득 포인트</span></div></div><button className="primary-button" onClick={onClose}>내 학습으로 돌아가기 <ArrowRight size={18} /></button></div> : <>
      <div className="study-progress"><span>{subject.topic}</span><strong>{index + 1}<span> / {questions.length}</span></strong></div><div className="progress-track"><i style={{ width: `${((index + (result ? 1 : 0)) / questions.length) * 100}%` }} /></div>
      <div className="study-question"><div className="row-between"><span className="tag">중학교 기초 · 샘플 문항</span><button className={`icon-button ${bookmarked ? "bookmarked" : ""}`} aria-label={bookmarked ? "북마크 해제" : "북마크 추가"} aria-pressed={bookmarked} onClick={() => update(p => ({ ...p, bookmarks: p.bookmarks.includes(q.id) ? p.bookmarks.filter(id => id !== q.id) : [...p.bookmarks, q.id] }))}><Bookmark size={21} fill={bookmarked ? "currentColor" : "none"} /></button></div><h3>{q.prompt}</h3>{q.expression && <p className="equation">{q.expression}</p>}
      <div className="answer-grid" role="group" aria-label="답안 선택">{q.choices.map((choice, i) => <button key={i} disabled={!!result} aria-pressed={answer === i} className={`answer-option ${answer === i ? "selected" : ""} ${result && i === q.answer ? "correct" : ""} ${result && answer === i && !result.correct ? "incorrect" : ""}`} onClick={() => setAnswer(i)}><span>{i + 1}</span>{q.expression ? `x = ${choice}` : choice}{result && i === q.answer && <Check size={18} />}</button>)}</div></div>
      {!result ? <><p className="assessment-title">정답을 확인하기 전에, 얼마나 이해했나요?</p><div className="confidence-grid">{CONFIDENCES.map(({ id, title, Icon }) => <button key={id} className={`confidence-choice ${id} ${confidence === id ? "selected" : ""}`} aria-pressed={confidence === id} onClick={() => setConfidence(id)}><Icon size={24} /><span>{title}</span></button>)}</div><p className="muted center small">모르는 걸 발견한 것도 성장입니다. 솔직하게 골라주세요.</p><button className="primary-button full-width" disabled={answer === null || !confidence} onClick={submit}>정답 확인하기 <ArrowRight size={18} /></button></> : <div className="answer-result" aria-live="polite"><div className="row-between"><h3>{result.correct ? <CheckCircle2 size={21} /> : <Sparkles size={21} />}{result.correct ? "정확해요, 잘했어요!" : "괜찮아요, 함께 알아봐요."}</h3><span className="tag">+{result.points} P</span></div><p>{q.explanation}</p><p className="muted small">{result.dueDate.slice(5).replace("-", "/")}에 다시 만나며 기억을 단단하게 만들어요.</p><button className="primary-button full-width" onClick={next}>{index === questions.length - 1 ? "학습 마무리하기" : "다음 문제"}<ArrowRight size={18} /></button></div>}
      {error && <p role="alert">{error}</p>}
    </>}
  </Modal>;
}
