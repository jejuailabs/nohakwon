"use client";
import { useState } from "react";
import { BookOpen, Check, Plus } from "lucide-react";
import { SUBJECT_NAMES, type Book } from "@/lib/learning";
import { gradeLabel, type Grade } from "@/lib/education";
import type { TextbookIdentity } from "@/lib/matching";
import type { TextbookPhotoResult } from "@/lib/textbook-recognition";
import { accountRequest } from "./account-provider";
import { SubjectCompanion, companionStyle } from "./adventure";

type Choice = {
  catalogId: string;
  grade: Grade;
  currentUnit: string;
  endUnit: string;
};
function choiceFor(book: Book, learnerGrade: Grade): Choice {
  return {
    catalogId: book.id,
    grade: book.flexibleGrade && learnerGrade <= 3 ? learnerGrade : book.grade,
    currentUnit: book.units[0].id,
    endUnit: book.units.at(-1)!.id,
  };
}

export function TextbookPhotoResults({
  photo,
  result,
  registered,
  learnerGrade,
  onAdded,
  onSearch,
}: {
  photo: { name: string; url: string } | null;
  result: TextbookPhotoResult;
  registered: string[];
  learnerGrade: Grade;
  onAdded: (added: number, warning: string) => Promise<void>;
  onSearch: (identity?: TextbookIdentity) => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice | undefined>>(
    () => {
      const used = new Set(registered);
      return Object.fromEntries(
        result.groups.map((group) => {
          const only =
            group.matches.length === 1 && !group.requiresReview
              ? group.matches[0].book
              : undefined;
          const selected = only && !used.has(only.id) ? only : undefined;
          if (selected) used.add(selected.id);
          return [
            group.id,
            selected
              ? choiceFor(selected, group.identity.grade ?? learnerGrade)
              : undefined,
          ];
        }),
      );
    },
  );
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const pending = [
    ...new Map(
      result.groups.flatMap((group) => {
        const choice = choices[group.id];
        return choice && !registered.includes(choice.catalogId)
          ? [[choice.catalogId, choice] as const]
          : [];
      }),
    ).values(),
  ];
  async function addSelected() {
    setSaving(true);
    setError("");
    let committed = false;
    try {
      const response = await accountRequest<{
        added: number;
        existing: number;
        warning: string;
      }>("/api/books", "POST", {
        action: "add-catalogs",
        selections: pending.map(({ catalogId, ...selection }) => ({
          catalogId,
          selection,
        })),
      });
      committed = true;
      await onAdded(response.added, response.warning);
    } catch (e) {
      setError(
        committed
          ? "교재 추가는 완료됐어요. 화면을 새로고침해 등록한 교재를 확인해 주세요."
          : e instanceof Error
            ? e.message
            : "교과서를 추가하지 못했어요.",
      );
    } finally {
      setSaving(false);
    }
  }
  function selectBook(groupId: string, book: Book) {
    setChoices((old) => ({
      ...Object.fromEntries(
        Object.entries(old).map(([key, value]) => [
          key,
          value?.catalogId === book.id ? undefined : value,
        ]),
      ),
      [groupId]: choiceFor(
        book,
        result.groups.find((group) => group.id === groupId)?.identity.grade ??
          learnerGrade,
      ),
    }));
  }
  return (
    <section
      className="workspace-stack textbook-photo-results"
      aria-label="사진 인식 결과"
      aria-busy={saving}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">REVIEW YOUR TEXTBOOKS</p>
          <h2>사진에서 찾은 교과서 {result.groups.length}권</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={saving}
          onClick={() => onSearch()}
        >
          교재명으로 다시 찾기
        </button>
      </div>
      <p className="muted">
        출판사·저자·개정판과 목차를 확인해 주세요. 후보가 여러 개면 내 교과서를
        고르세요. 최종 추가 버튼을 눌러야 저장됩니다.
      </p>
      {photo && (
        <details className="panel textbook-photo-source">
          <summary>올린 사진 확인 · {photo.name}</summary>
          <img src={photo.url} alt="교과서 인식에 사용한 사진" />
        </details>
      )}
      {result.warning && <p className="workspace-notice">{result.warning}</p>}
      {!result.groups.length && (
        <div className="panel empty-state">
          <BookOpen size={30} />
          <h3>교과서 정보를 읽지 못했어요</h3>
          <p>
            과목과 출판사가 선명하게 보이도록 다시 촬영하거나 교재명으로 찾아
            주세요.
          </p>
        </div>
      )}
      <div className="book-grid">
        {result.groups.map((group, index) => {
          const choice = choices[group.id];
          const selected = group.matches.find(
            (m) => m.book.id === choice?.catalogId,
          )?.book;
          const label = `${index + 1}. ${group.identity.title || (group.identity.subject ? SUBJECT_NAMES[group.identity.subject] : "교과서")}`;
          return (
            <article
              className="panel textbook-photo-card"
              key={group.id}
              style={
                group.identity.subject
                  ? companionStyle(group.identity.subject)
                  : undefined
              }
            >
              {group.identity.subject && (
                <SubjectCompanion subject={group.identity.subject} />
              )}
              <span className="tag">
                {group.identity.subject
                  ? SUBJECT_NAMES[group.identity.subject]
                  : "과목 확인 필요"}
                {group.identity.grade ? ` · ${group.identity.grade}학년` : ""}
              </span>
              <h3>{label}</h3>
              <p className="muted">
                {[
                  group.identity.publisher,
                  group.identity.author,
                  group.identity.curriculum &&
                    `${group.identity.curriculum} 개정`,
                  group.identity.volume,
                ]
                  .filter(Boolean)
                  .join(" · ") || "출판사·저자 정보를 확인해 주세요."}
              </p>
              {group.identity.warning && (
                <p className="small muted">{group.identity.warning}</p>
              )}
              {group.requiresReview && (
                <p className="workspace-notice">
                  사진에서 읽은 저자 ‘{group.identity.author}’와 일치하는 교재가
                  없어요. 나머지 정보가 같은 후보를 보여 드리니 저자를 확인하고
                  직접 선택해 주세요.
                </p>
              )}
              {!group.matches.length ? (
                <div className="workspace-notice">
                  <p>
                    일치하는 교과서를 찾지 못했어요. 다른 출판사의 교과서로 대신
                    추가하지 않습니다.
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() => onSearch(group.identity)}
                  >
                    이 교과서 이름으로 찾기
                  </button>
                </div>
              ) : (
                <fieldset className="textbook-candidates" disabled={saving}>
                  <legend>
                    {group.matches.length === 1
                      ? "연결할 교과서"
                      : `후보 ${group.matches.length}개 중 선택`}
                  </legend>
                  {group.matches.map(({ book }) => (
                    <label
                      className={`textbook-candidate ${choice?.catalogId === book.id ? "selected" : ""}`}
                      key={book.id}
                    >
                      <input
                        type="radio"
                        name={`candidate-${group.id}`}
                        value={book.id}
                        checked={choice?.catalogId === book.id}
                        disabled={registered.includes(book.id)}
                        onChange={() => selectBook(group.id, book)}
                      />
                      <span>
                        <strong>
                          {book.publisher}
                          {book.author ? ` · ${book.author}` : ""}
                        </strong>
                        <small>
                          {book.title} · {book.curriculum} 개정 ·{" "}
                          {gradeLabel(book, true)}
                        </small>
                        {registered.includes(book.id) && (
                          <small>이미 등록한 교과서</small>
                        )}
                      </span>
                    </label>
                  ))}
                  <label className="textbook-candidate textbook-skip">
                    <input
                      type="radio"
                      name={`candidate-${group.id}`}
                      checked={!choice}
                      onChange={() =>
                        setChoices((old) => ({ ...old, [group.id]: undefined }))
                      }
                    />
                    <span>이번에는 추가하지 않기</span>
                  </label>
                </fieldset>
              )}
              {selected && choice && (
                <div className="textbook-selected-details">
                  <details>
                    <summary>{selected.units.length}개 단원 목차 확인</summary>
                    <ol className="book-units">
                      {selected.units.map((unit) => (
                        <li key={unit.id}>{unit.title}</li>
                      ))}
                    </ol>
                  </details>
                  {selected.flexibleGrade && (
                    <label>
                      사회 학습 학년
                      <select
                        aria-label={`${label} 학습 학년`}
                        value={choice.grade}
                        disabled={saving}
                        onChange={(e) =>
                          setChoices((old) => ({
                            ...old,
                            [group.id]: {
                              ...choice,
                              grade: Number(e.target.value) as Grade,
                            },
                          }))
                        }
                      >
                        {[1, 2, 3].map((g) => (
                          <option key={g} value={g}>
                            중학교 {g}학년
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="form-grid textbook-photo-range">
                    <label>
                      시작 단원
                      <select
                        aria-label={`${label} 시작 단원`}
                        value={choice.currentUnit}
                        disabled={saving}
                        onChange={(e) => {
                          const start = e.target.value;
                          setChoices((old) => ({
                            ...old,
                            [group.id]: {
                              ...choice,
                              currentUnit: start,
                              endUnit:
                                selected.units.findIndex(
                                  (u) => u.id === choice.endUnit,
                                ) <
                                selected.units.findIndex((u) => u.id === start)
                                  ? start
                                  : choice.endUnit,
                            },
                          }));
                        }}
                      >
                        {selected.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      종료 단원
                      <select
                        aria-label={`${label} 종료 단원`}
                        value={choice.endUnit}
                        disabled={saving}
                        onChange={(e) =>
                          setChoices((old) => ({
                            ...old,
                            [group.id]: { ...choice, endUnit: e.target.value },
                          }))
                        }
                      >
                        {selected.units
                          .filter(
                            (_, i) =>
                              i >=
                              selected.units.findIndex(
                                (u) => u.id === choice.currentUnit,
                              ),
                          )
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="storage-warning">
          {error}
        </p>
      )}
      <div className="panel textbook-photo-confirm">
        <div>
          <strong>
            <Check size={18} /> 추가할 교과서 {pending.length}권
          </strong>
          <p className="muted small">
            사진 인식만으로 교재가 저장되지는 않습니다. 이미 등록한 교재의
            진도와 학습 자료는 유지됩니다.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={saving || !pending.length}
          onClick={() => void addSelected()}
        >
          <Plus size={18} />
          {saving
            ? "교과서를 추가하고 있어요…"
            : `선택한 ${pending.length}권 최종 추가`}
        </button>
      </div>
    </section>
  );
}
