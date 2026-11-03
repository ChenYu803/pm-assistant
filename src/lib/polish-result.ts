import type { CreditCallView } from "@/lib/credit-values";

export type PolishResult = {
  requestId?: string;
  state?: "running" | "completed" | "failed" | "stopped";
  polished?: string;
  error?: string;
  creditCall?: CreditCallView;
};
