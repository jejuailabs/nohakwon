import Link from "next/link";
export default function BillingFail(){return <main className="app theme-b billing-app"><div className="billing-main panel workspace-stack"><h1>결제를 완료하지 못했어요</h1><p>카드 등록을 취소했거나 인증에 실패했어요. 결제 관리에서 상태를 확인하고 다시 시도해 주세요.</p><Link className="primary-button" href="/billing">결제 관리로</Link></div></main>;}
