import { AccountError } from "./account";
export function nextBillingMonth(iso: string) {
  const date = new Date(iso),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
export function verifyPayment(
  payment: Record<string, unknown>,
  order: { id: string; amount: number },
) {
  if (
    payment.orderId !== order.id ||
    payment.totalAmount !== order.amount ||
    payment.currency !== "KRW" ||
    typeof payment.paymentKey !== "string"
  )
    throw new AccountError(
      502,
      "결제 정보가 주문과 일치하지 않습니다. 고객 지원에 문의해 주세요.",
    );
  return payment.status;
}
