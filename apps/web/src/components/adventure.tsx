import type { CSSProperties, ReactNode } from "react";
import {
  BookOpen,
  Compass,
  Feather,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { SubjectId } from "@nohakwon/core";
import { SUBJECTS } from "@/lib/questions";
import { Localize } from "./localize";

const CHAPTERS = {
  books: {
    number: "01",
    label: "모험의 서재",
    title: "나의 교재",
    description: "교과서의 순서대로, 지금 배우는 범위에 맞춰.",
    subject: "korean",
    quote: "한 권의 교재에서, 새로운 이야기가 시작돼.",
    Icon: BookOpen,
  },
  reviews: {
    number: "02",
    label: "기억의 수련장",
    title: "기억을 단단하게",
    description: "모르거나 헷갈렸던 개념부터 차근차근.",
    subject: "math",
    quote: "다시 만난 개념은, 더 오래 빛날 거야.",
    Icon: Sparkles,
  },
  notes: {
    number: "03",
    label: "발견의 기록실",
    title: "나의 오답노트",
    description: "틀린 문제와 저장한 문제에서 다음 배움의 실마리를 찾아요.",
    subject: "english",
    quote: "괜찮아. 어려웠던 곳이 다음 모험의 시작이야.",
    Icon: Feather,
  },
  reports: {
    number: "04",
    label: "성장의 별자리",
    title: "최근 7일 학습 리포트",
    description: "실제 답안 기록으로 계산한 나의 변화",
    subject: "social",
    quote: "작은 발자국도 모이면, 나만의 길이 되지.",
    Icon: Compass,
  },
  history: {
    number: "07",
    label: "모험의 발자국",
    title: "문제 풀이 기록",
    description: "어떤 문제를 풀었고, 다음 배움으로 어떻게 이어졌는지.",
    subject: "social",
    quote: "지나온 발자국에는, 다음 길의 힌트가 있어.",
    Icon: Feather,
  },
  family: {
    number: "05",
    label: "함께하는 베이스캠프",
    title: "보호자 학습 관리",
    description: "자녀별 교재와 학습 기록을 구분해서 관리해요.",
    subject: "science",
    quote: "각자의 속도로 자라는 배움을 함께 응원해.",
    Icon: ShieldCheck,
  },
  settings: {
    number: "06",
    label: "모험가의 준비실",
    title: "학습 설정",
    description: "화면부터 학습 목표까지, 나에게 편안한 모험을 준비해요.",
    subject: "english",
    quote: "가장 좋은 모험의 속도는, 너에게 맞는 속도야.",
    Icon: Settings2,
  },
} as const;

export function companionStyle(subject: SubjectId): CSSProperties {
  const index = SUBJECTS.findIndex((s) => s.id === subject);
  return {
    "--companion-color": SUBJECTS[index].color,
    "--companion-position": `${index * 25}%`,
    "--companion-focus": `${[14, 31, 23, 30, 37][index]}%`,
  } as CSSProperties;
}

export function CompanionPortrait({
  subject,
  className = "",
}: {
  subject: SubjectId;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`companion-portrait ${className}`}
      style={companionStyle(subject)}
    />
  );
}

export function SubjectCompanion({
  subject,
  detail,
}: {
  subject: SubjectId;
  detail?: string;
}) {
  const companion = SUBJECTS.find((s) => s.id === subject)!;
  return (
    <Localize>
      <span className="subject-companion" style={companionStyle(subject)}>
        <CompanionPortrait subject={subject} />
        <span>
          <strong>{companion.name}</strong>
          <small data-localize={detail ? "off" : undefined}>
            {detail ?? companion.title}
          </small>
        </span>
      </span>
    </Localize>
  );
}

export function AdventureHeader({
  chapter,
  children,
  actions,
}: {
  chapter: keyof typeof CHAPTERS;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const entry = CHAPTERS[chapter];
  const companion = SUBJECTS.find((s) => s.id === entry.subject)!;
  return (
    <Localize>
      <section
        className={`adventure-header adventure-${chapter}`}
        style={companionStyle(entry.subject)}
      >
        <div className="adventure-copy">
          <p className="adventure-kicker">
            <entry.Icon size={15} />
            <span>{entry.label}</span>
            <span className="adventure-chapter" data-localize="off">
              CHAPTER {entry.number}
            </span>
          </p>
          <h1>{entry.title}</h1>
          <p className="adventure-description">{entry.description}</p>
          {children && <div className="adventure-facts">{children}</div>}
          {actions && <div className="adventure-actions">{actions}</div>}
        </div>
        <div className="adventure-guide">
          <span className="adventure-orbit" aria-hidden="true" />
          <CompanionPortrait
            subject={entry.subject}
            className="adventure-character"
          />
          <div className="adventure-dialogue">
            <span>{companion.title}</span>
            <p>{entry.quote}</p>
          </div>
          <span className="adventure-star" aria-hidden="true">
            ✦
          </span>
        </div>
      </section>
    </Localize>
  );
}

export function AdventureEmpty({
  subject = "math",
  title,
  description,
  children,
}: {
  subject?: SubjectId;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Localize>
      <div
        className="panel empty-state adventure-empty"
        style={companionStyle(subject)}
      >
        <CompanionPortrait subject={subject} />
        <span className="eyebrow">YOUR NEXT CHAPTER</span>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    </Localize>
  );
}
