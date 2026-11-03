"use client";
import { ReplyCredits } from "@/components/ConversationCredits";
import type { useFilePolish } from "@/components/useFilePolish";

export function FilePolishResult({polish}: {polish: ReturnType<typeof useFilePolish>}) {
  return <div className="mt-3 space-y-2 text-xs">
    {polish.busy && <button type="button" className="underline underline-offset-4" onClick={() => void polish.stop()}>停止润色</button>}
    {polish.error && <p role="alert" className="text-destructive">{polish.error}</p>}
    <div role="status" aria-live="polite" className="text-muted-foreground">
      <ReplyCredits call={polish.creditCall} />
      <p>润色按模型调用计费；不采用或关闭结果仍保留已发生的消耗。手工编辑与保存免费。</p>
    </div>
    {polish.polishedContent && <div className="rounded-lg border border-border bg-muted p-4">
      <p className="mb-2 font-medium">AI 润色结果</p>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap">{polish.polishedContent}</pre>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="underline underline-offset-4" onClick={() => polish.dismiss(true)}>应用润色</button>
        <button type="button" className="underline underline-offset-4" onClick={() => polish.dismiss(false)}>保留原文</button>
      </div>
    </div>}
  </div>;
}
