import { CreditError, creditUnits } from "@/lib/credit-values";

export type ManualRefundInput = { accountId: string; rechargeEntryId: string; requestId: string; refundRmb: string; reason: string };
export type RefundAction = { action: "confirm-transfer" | "mark-failed" | "complete"; reason: string; externalReference?: string };
export type ManualRefund = {
  id: string; accountId: string; accountEmail: string; rechargeEntryId: string; sourceId: string;
  actorId: string; actorEmail: string; requestId: string; refundRmb: string; credits: string; reason: string;
  transferStatus: "unverified" | "succeeded" | "failed"; accountingStatus: "held" | "completed" | "released";
  externalReference: string | null; transferReason: string | null; createdAt: string; updatedAt: string;
};
export type RefundSource = {
  rechargeEntryId: string; sourceId: string; receiptReference: string; originalPaidRmb: string; originalCredits: string;
  available: string; reserved: string; refundHeld: string; remainingPaidRmb: string; refundableRmb: string;
};
export const TRANSFER_LABELS = { unverified: "外部转账待核实", succeeded: "外部退款已确认", failed: "已核实未退款或转账失败" };
export const REFUND_ACCOUNTING_LABELS = { held: "积分已锁定", completed: "内部扣账完成", released: "锁定已释放" };

export function refundMoney(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value) || creditUnits(value) <= BigInt(0)) throw new CreditError("退款人民币须大于零、最多两位小数，且不超过 999999999.99 元。");
  return value;
}
export function refundReason(value: unknown) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 500) throw new CreditError("请填写 1 至 500 个字符的核实说明。");
  return value.trim();
}
export function parseRefundAction(body: unknown): RefundAction {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreditError("请求格式不正确。");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["action", "reason", "externalReference"].includes(key)) || !["confirm-transfer", "mark-failed", "complete"].includes(value.action as string)) throw new CreditError("请选择核实转账结果或重试内部记账。");
  let externalReference: string | undefined;
  if (value.externalReference !== undefined) {
    if (typeof value.externalReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.externalReference.trim())) throw new CreditError("外部参考号须为 1 至 128 位字母、数字或 . _ : -。");
    externalReference = value.externalReference.trim().toUpperCase();
  }
  if (value.action === "confirm-transfer" && !externalReference) throw new CreditError("请填写已核实的外部退款交易参考号。");
  if (value.action === "complete" && externalReference) throw new CreditError("重试内部记账不接受新的转账参考号。");
  return { action: value.action as RefundAction["action"], reason: refundReason(value.reason), ...(externalReference ? { externalReference } : {}) };
}
