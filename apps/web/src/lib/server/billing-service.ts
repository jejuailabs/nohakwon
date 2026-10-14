import "server-only";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import { id, object, text } from "@/lib/learning";
import { nextBillingMonth, verifyPayment } from "@/lib/billing";
import { studentFor, learningConfig, entitlement } from "./workspace";

export function billingConfigured() {
  return Boolean(
    process.env.TOSS_SECRET_KEY &&
      process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY &&
      process.env.BILLING_ENCRYPTION_KEY,
  );
}
function guard() {
  if (!billingConfigured())
    throw new AccountError(
      503,
      "토스페이먼츠 테스트 키와 결제 암호화 키가 아직 연결되지 않았어요.",
    );
  const test = process.env.TOSS_SECRET_KEY!.startsWith("test_");
  if (
    !test &&
    !(
      process.env.TOSS_MODE === "live" &&
      process.env.ENABLE_LIVE_BILLING === "true"
    )
  )
    throw new AccountError(503, "실결제는 아직 활성화되지 않았어요.");
  return test;
}
function encryptionKey() {
  const key = Buffer.from(process.env.BILLING_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32)
    throw new AccountError(503, "결제 암호화 설정을 확인해 주세요.");
  return key;
}
export function encryptBillingKey(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv),
    encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
function decryptBillingKey(value: string) {
  const [iv, tag, body] = value.split(".").map((v) => Buffer.from(v, "base64")),
    cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
async function toss(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  guard();
  let response: Response;
  try {
    response = await fetch(`https://api.tosspayments.com${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(65000),
    });
  } catch {
    throw new AccountError(
      504,
      "결제 결과를 확인 중입니다. 같은 요청을 다시 확인해 주세요. 중복 주문을 만들지 않습니다.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new AccountError(
      502,
      `결제 서비스 요청에 실패했어요. (${typeof data.code === "string" ? data.code : response.status})`,
    );
  return data as Record<string, any>;
}
export async function billingStatus(uid: string) {
  const { ref, data } = await studentFor(uid, true),
    subscription = (
      await adminDb().collection("subscriptions").doc(ref.id).get()
    ).data(),
    orders = await adminDb()
      .collection("orders")
      .where("studentId", "==", ref.id)
      .limit(50)
      .get();
  return {
    configured: billingConfigured(),
    test:
      !process.env.TOSS_SECRET_KEY ||
      process.env.TOSS_SECRET_KEY.startsWith("test_"),
    entitlement: entitlement(data),
    amount: subscription?.amount ?? (await learningConfig()).subscriptionWon,
    cardRegistered: !!subscription?.encryptedKey,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    orders: orders.docs
      .map((d) => {
        const o = d.data();
        return {
          id: d.id,
          status: o.status,
          amount: o.amount,
          createdAt: o.createdAt,
          periodEnd: o.periodEnd,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
export async function prepareBilling(uid: string, consent: boolean) {
  guard();
  if (!consent) throw new AccountError(400, "자동 결제 안내에 동의해 주세요.");
  const { ref, data } = await studentFor(uid, true),
    db = adminDb(),
    amount = (await learningConfig()).subscriptionWon;
  if (entitlement(data).status === "active")
    throw new AccountError(409, "이미 구독 중인 학습 프로필입니다.");
  const state = randomUUID(),
    customerKey = randomUUID(),
    stateRef = db.collection("billingStates").doc(state),
    now = Date.now();
  await db.runTransaction(async (tx) => {
    const student = (await tx.get(ref)).data()!;
    if (student.billingPending && student.billingPendingExpires > now)
      throw new AccountError(
        409,
        "카드 등록이 진행 중이에요. 기존 창을 완료하거나 15분 후 다시 시도해 주세요.",
      );
    tx.set(stateRef, {
      uid,
      studentId: ref.id,
      customerKey,
      amount,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt: now + 15 * 60000,
    });
    tx.update(ref, {
      billingPending: state,
      billingPendingExpires: now + 15 * 60000,
    });
  });
  return {
    state,
    customerKey,
    clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    amount,
  };
}
export async function completeBilling(uid: string, raw: unknown) {
  const test = guard(),
    v = object(raw),
    state = id(v.state),
    customerKey = text(v.customerKey, 300, "고객 키"),
    authKey = text(v.authKey, 300, "인증 키"),
    db = adminDb(),
    stateRef = db.collection("billingStates").doc(state);
  const saved = await db.runTransaction(async (tx) => {
    const s = (await tx.get(stateRef)).data();
    if (
      !s ||
      s.uid !== uid ||
      s.customerKey !== customerKey ||
      s.status === "canceled"
    )
      throw new AccountError(403, "결제 인증 요청이 일치하지 않아요.");
    if (s.status === "complete") return s;
    if (s.expiresAt < Date.now())
      throw new AccountError(
        409,
        "카드 등록 시간이 만료됐어요. 다시 시작해 주세요.",
      );
    if (s.lockedUntil > Date.now())
      throw new AccountError(
        409,
        "결제 결과를 처리하고 있어요. 잠시 후 다시 확인해 주세요.",
      );
    tx.update(stateRef, { lockedUntil: Date.now() + 90000 });
    return s;
  });
  if (saved.status === "complete") return { ok: true };
  try {
    const subRef = db.collection("subscriptions").doc(saved.studentId),
      sub = (await subRef.get()).data();
    if (sub?.state !== state) {
      const issued = await toss(
        "/v1/billing/authorizations/issue",
        "POST",
        { authKey, customerKey },
        `issue-${state}`,
      );
      if (
        issued.customerKey !== customerKey ||
        typeof issued.billingKey !== "string"
      )
        throw new AccountError(502, "카드 등록 정보를 확인하지 못했어요.");
      await subRef.set({
        uid,
        studentId: saved.studentId,
        state,
        customerKey,
        encryptedKey: encryptBillingKey(issued.billingKey),
        amount: saved.amount,
        test,
        cancelAtPeriodEnd: false,
        paidUntil: sub?.paidUntil ?? "",
        createdAt: new Date().toISOString(),
      });
    }
    await chargeSubscription(saved.studentId, `first-${state}`);
    await stateRef.update({ status: "complete", lockedUntil: 0 });
    await db
      .collection("students")
      .doc(saved.studentId)
      .update({ billingPending: "", billingPendingExpires: 0 });
    return { ok: true };
  } catch (error) {
    await stateRef.update({ lockedUntil: 0 });
    throw error;
  }
}
export async function chargeSubscription(
  studentId: string,
  firstOrderId?: string,
) {
  guard();
  const db = adminDb(),
    subRef = db.collection("subscriptions").doc(id(studentId)),
    sub = (await subRef.get()).data();
  if (!sub || sub.cancelAtPeriodEnd || !sub.encryptedKey) {
    if (firstOrderId)
      throw new AccountError(
        409,
        "카드 등록 또는 구독 상태를 다시 확인해 주세요.",
      );
    return;
  }
  const now = new Date();
  if (
    !firstOrderId &&
    sub.paidUntil &&
    Date.parse(sub.paidUntil) > now.getTime()
  )
    return;
  const orderId =
      firstOrderId ??
      `renew-${studentId}-${(sub.paidUntil || now.toISOString()).slice(0, 10)}`,
    orderRef = db.collection("orders").doc(orderId);
  const order = await db.runTransaction(async (tx) => {
    const [existing, sSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(subRef),
    ]);
    const s = sSnap.data()!;
    if (s.cancelAtPeriodEnd) throw new AccountError(409, "해지한 구독입니다.");
    const old = existing.data();
    if (old?.status === "DONE") return null;
    if (old?.lockedUntil > Date.now())
      throw new AccountError(
        409,
        "결제 처리 중이에요. 잠시 후 결제 내역을 확인해 주세요.",
      );
    if (old && Date.now() - Date.parse(old.createdAt) > 14 * 86400000)
      throw new AccountError(
        409,
        "이전 결제의 최종 상태를 운영자가 확인해야 합니다.",
      );
    const created = old ?? {
      id: orderId,
      uid: s.uid,
      studentId,
      amount: s.amount,
      createdAt: now.toISOString(),
      periodStart:
        s.paidUntil && Date.parse(s.paidUntil) > now.getTime()
          ? s.paidUntil
          : now.toISOString(),
      periodEnd: nextBillingMonth(
        s.paidUntil && Date.parse(s.paidUntil) > now.getTime()
          ? s.paidUntil
          : now.toISOString(),
      ),
      status: "PENDING",
    };
    tx.set(orderRef, { ...created, lockedUntil: Date.now() + 90000 });
    return created;
  });
  if (!order) return;
  try {
    const payment = await toss(
      `/v1/billing/${encodeURIComponent(decryptBillingKey(sub.encryptedKey))}`,
      "POST",
      {
        customerKey: sub.customerKey,
        amount: order.amount,
        orderId,
        orderName: "노학원 학습자 월 구독",
      },
      `charge-${orderId}`,
    );
    await applyPayment(payment, orderId);
  } catch (error) {
    await orderRef.update({
      status: "PENDING",
      lockedUntil: 0,
      lastError:
        error instanceof AccountError ? error.message : "결제 확인 실패",
    });
    throw error;
  }
}
export async function applyPayment(
  payment: Record<string, unknown>,
  orderId: string,
) {
  const db = adminDb(),
    orderRef = db.collection("orders").doc(id(orderId));
  await db.runTransaction(async (tx) => {
    const saved = (await tx.get(orderRef)).data();
    if (!saved) throw new AccountError(404, "주문이 없어요.");
    const order = { ...saved, id: orderRef.id, amount: saved.amount as number },
      status = verifyPayment(payment, order);
    if (saved.paymentKey && saved.paymentKey !== payment.paymentKey)
      throw new AccountError(502, "결제 키가 기존 주문과 일치하지 않습니다.");
    if (saved.status === status || saved.status === "CANCELED") return;
    const subRef = db.collection("subscriptions").doc(saved.studentId),
      sub = (await tx.get(subRef)).data();
    if (!sub) throw new AccountError(409, "구독 정보를 확인해 주세요.");
    if (status === "DONE" && saved.status !== "DONE") {
      tx.update(orderRef, {
        status: "DONE",
        paymentKey: payment.paymentKey,
        lockedUntil: 0,
      });
      tx.update(subRef, { paidUntil: saved.periodEnd, lastOrderId: orderId });
      tx.update(db.collection("students").doc(saved.studentId), {
        paidUntil: saved.periodEnd,
        billingTest: sub.test,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      });
    } else if (status === "CANCELED" && saved.status !== "CANCELED") {
      tx.update(orderRef, { status: "CANCELED", lockedUntil: 0 });
      if (sub.lastOrderId === orderId) {
        tx.update(subRef, {
          paidUntil: new Date().toISOString(),
          cancelAtPeriodEnd: true,
        });
        tx.update(db.collection("students").doc(saved.studentId), {
          paidUntil: new Date().toISOString(),
          cancelAtPeriodEnd: true,
        });
      }
    } else if (status !== "DONE")
      throw new AccountError(
        409,
        "결제가 아직 완료되지 않았어요. 결제 상태를 다시 확인해 주세요.",
      );
  });
}
export async function reconcileOrder(uid: string, orderId: string) {
  const ref = adminDb().collection("orders").doc(id(orderId)),
    order = (await ref.get()).data();
  if (order?.uid !== uid) throw new AccountError(404, "주문이 없어요.");
  const payment = await toss(
    `/v1/payments/orders/${encodeURIComponent(orderId)}`,
  );
  await applyPayment(payment, orderId);
}
export async function paymentWebhook(raw: unknown) {
  const v = object(raw),
    data = object(v.data),
    orderId = id(data.orderId),
    order = (await adminDb().collection("orders").doc(orderId).get()).data();
  if (!order) return;
  const payment = await toss(
    `/v1/payments/orders/${encodeURIComponent(orderId)}`,
  );
  await applyPayment(payment, orderId);
}
export async function cancelSubscription(uid: string) {
  const { ref } = await studentFor(uid, true),
    db = adminDb();
  await db.runTransaction(async (tx) => {
    const subRef = db.collection("subscriptions").doc(ref.id),
      sub = (await tx.get(subRef)).data();
    if (!sub || sub.uid !== uid) throw new AccountError(404, "구독이 없어요.");
    tx.update(subRef, {
      cancelAtPeriodEnd: true,
      canceledAt: new Date().toISOString(),
    });
    tx.update(ref, { cancelAtPeriodEnd: true });
  });
}
export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header),
    b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
