"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { LearningPreparation, LearnMode, Job } from "@/lib/learning";
import type { StudyAssignment } from "./server-study";
import { accountRequest } from "./account-provider";
import { Localize } from "./localize";

type Request = {
  action: "start";
  mode: LearnMode;
  requestId: string;
  bookId?: string;
  questionId?: string;
  unitId?: string;
  concept?: string;
  skillType?: string;
};
type Launch = { request: Request; jobs: Job[]; error: string };
type Reply = StudyAssignment | LearningPreparation;

export function useLearningLauncher(
  onReady: (assignment: StudyAssignment) => void,
  onRefresh: () => Promise<void>,
) {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const serial = useRef(0),
    ready = useRef(onReady),
    refresh = useRef(onRefresh);
  ready.current = onReady;
  refresh.current = onRefresh;
  const requestId = launch?.request.requestId;
  const close = useCallback(() => {
    ++serial.current;
    setLaunch(null);
  }, []);
  useEffect(() => {
    if (!launch || launch.error) return;
    const captured = ++serial.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const request = launch.request;
    const began = Date.now();
    async function poll() {
      try {
        const result = await accountRequest<Reply>(
          "/api/learn",
          "POST",
          request,
        );
        if (!active || captured !== serial.current) return;
        if ("preparing" in result) {
          setLaunch((old) => (old ? { ...old, jobs: result.jobs } : old));
          if (Date.now() - began > 6 * 60 * 1000)
            throw new Error(
              "문제 준비가 예상보다 오래 걸리고 있어요. 출제 상태를 확인한 뒤 다시 시작해 주세요.",
            );
          timer = setTimeout(() => void poll(), 3500);
        } else {
          setLaunch(null);
          ready.current(result);
          void refresh.current();
        }
      } catch (e) {
        if (active && captured === serial.current) {
          setLaunch((old) =>
            old ? { ...old, error: (e as Error).message } : old,
          );
          void refresh.current();
        }
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // A stable request ID resumes the same session throughout preparation.
  }, [requestId]);
  return {
    launch,
    start(
      mode: LearnMode = "daily",
      bookId?: string,
      questionId?: string,
      options: { concept?: string; skillType?: string; unitId?: string } = {},
    ) {
      if (launch && !launch.error) return;
      setLaunch({
        request: {
          action: "start",
          mode,
          requestId: crypto.randomUUID(),
          ...options,
          ...(bookId ? { bookId } : {}),
          ...(questionId ? { questionId } : {}),
        },
        jobs: [],
        error: "",
      });
    },
    close,
  };
}

export function LearningLaunchDialog({
  launch,
  onClose,
  onBooks,
}: {
  launch: Launch | null;
  onClose: () => void;
  onBooks: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!launch) return;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const buttons =
          dialog.current?.querySelectorAll<HTMLButtonElement>("button");
        if (!buttons?.length) return;
        if (e.shiftKey && document.activeElement === buttons[0]) {
          e.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === buttons[buttons.length - 1]
        ) {
          e.preventDefault();
          buttons[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
    };
  }, [!!launch, onClose]);
  if (!launch) return null;
  return (
    <Localize>
      <div className="study-backdrop">
        <section
          ref={dialog}
          className="server-study panel learning-launch"
          role="dialog"
          aria-modal="true"
          aria-labelledby="learning-launch-heading"
        >
          <div className="section-heading">
            <span className="tag">나의 교재로 시작하는 학습</span>
            <button
              className="icon-button"
              aria-label="학습 준비 닫기"
              onClick={onClose}
            >
              <X />
            </button>
          </div>
          <h2 id="learning-launch-heading">
            {launch.error
              ? "학습 자료를 확인해 주세요"
              : "학습할 문제를 준비하고 있어요"}
          </h2>
          {launch.error ? (
            <>
              <p className="storage-warning" role="alert">
                {launch.error}
              </p>
              <button
                className="primary-button"
                onClick={() => {
                  onClose();
                  onBooks();
                }}
              >
                교재와 학습 자료 확인
              </button>
            </>
          ) : (
            <>
              <p role="status" className="workspace-notice">
                <LoaderCircle className="launch-spinner" size={18} />
                {launch.jobs[0]?.stage ||
                  "교재와 준비된 문제를 확인하고 있어요."}
              </p>
              <p>
                처음에는 단원 범위 확인과 문제 검증에 시간이 걸릴 수 있어요.
                준비가 끝나면 문제 화면이 자동으로 열립니다.
              </p>
              <p className="small muted">
                교과서 본문이 없으면 공개 자료로 확인한 개념을 새 예문으로
                연습해요. 작품·지문 자체에 관한 문제는 본문을 추가한 뒤 풀 수
                있어요.
              </p>
              <button className="secondary-button" onClick={onClose}>
                기다림 닫기
              </button>
              <p className="small muted">
                닫아도 이미 시작한 문제 준비는 계속됩니다.
              </p>
            </>
          )}
        </section>
      </div>
    </Localize>
  );
}
