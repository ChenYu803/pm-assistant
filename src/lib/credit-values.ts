/** 精确积分：数据库、HTTP 与界面共用十进制字符串，计算只使用 bigint。 */
export const CREDIT_SCALE = BigInt("100000000");
export type CreditBalance = { gift: { available: string; reserved: string }; purchased: { available: string; reserved: string } };
export class CreditError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function creditUnits(value: unknown): bigint {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,8})?$/.test(value)) throw new CreditError("积分应为十进制数字，最多八位小数。");
  const negative = value.startsWith("-"), [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return (BigInt(whole) * CREDIT_SCALE + BigInt(fraction.padEnd(8, "0"))) * (negative ? -BigInt("1") : BigInt("1"));
}
export function creditText(value: bigint): string {
  const abs = value < BigInt("0") ? -value : value;
  const fraction = (abs % CREDIT_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return (value < BigInt("0") ? "-" : "") + (abs / CREDIT_SCALE).toString() + (fraction ? "." + fraction : "");
}
export type CreditEntry = {
  id: string; accountId: string; accountEmail: string; actorId: string; actorEmail: string;
  requestId: string; businessType: string; reason: string; amount: string; sourceKind: "gift" | "purchased";
  before: CreditBalance; after: CreditBalance; allocations: { sourceId: string; amount: string }[];
  context: Record<string, unknown> | null; createdAt: string;
};
export type CreditCallView = { id: string; messageId: string; state: string; reserved: string; consumed: string | null; reason: string | null };
export type CreditStatement = { accountId: string; balance: CreditBalance; entries: CreditEntry[]; pendingCalls?: CreditCallView[]; total: number; page: number; pageSize: number };
export const CREDIT_BUSINESS_LABELS: Record<string, string> = { manual_recharge: "人工充值", admin_grant: "管理员赠送", admin_compensation: "补偿", admin_correction: "赠送余额纠正", invite_redemption: "邀请码赠送", model_reserve: "调用预留", model_settle: "模型消耗", model_release: "释放预留" };
