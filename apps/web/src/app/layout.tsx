import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";
import { AccountProvider } from "@/components/account-provider";

export const metadata: Metadata = {
  title: "nohakwon · 오늘의 작은 배움",
  description: "매일 조금씩, 더 멋진 나로. 다섯 과목의 동료와 함께 노학원에서 오늘의 학습 퀘스트를 시작하세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><AccountProvider>{children}</AccountProvider></body></html>;
}
