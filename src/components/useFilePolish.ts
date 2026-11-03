"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { GenerationResultError, readGenerationResult } from "@/lib/generation-result-client";
import type { PolishResult } from "@/lib/polish-result";
import type { CreditCallView } from "@/lib/credit-values";

type Draft = { content?: string; pending?: { requestId: string; content: string }; dismissed?: string };

/** 每个账号、文件独立保存原请求；未知结果只允许按原身份重试。 */
export function useFilePolish(open: boolean, target: { projectId: string; fileId: string } | undefined, initialContent: string) {
  const { data: session } = useSession();
  const [content,setContent] = useState(initialContent);
  const [polishedContent,setPolishedContent] = useState<string | null>(null);
  const [creditCall,setCreditCall] = useState<CreditCallView>();
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [ready,setReady] = useState(false);
  const [pending,setPending] = useState(false);
  const record = useRef<Draft>({content:initialContent});
  const sending = useRef(false), latestId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const path = target ? `/api/projects/${target.projectId}/files/${target.fileId}/polish` : "";
  const storageKey = session?.user?.id && target ? `polish:${session.user.id}:${target.projectId}:${target.fileId}` : "";

  function persist(next: Draft) {
    try { sessionStorage.setItem(storageKey,JSON.stringify(next)); record.current = next; setPending(!!next.pending); return true; }
    catch { setReady(false); setError("无法保存润色请求，请启用浏览器会话存储后重试；当前正文已保留。"); return false; }
  }
  function receive(result: PolishResult) {
    if (record.current.pending && result.requestId !== record.current.pending.requestId) return true;
    if (result.creditCall) setCreditCall(result.creditCall);
    if (result.requestId) latestId.current = result.requestId;
    if (result.state === "running") { setBusy(true); return true; }
    if (result.state === "completed" || result.state === "failed" || result.state === "stopped") {
      setBusy(false);
      if (!persist({...record.current,pending:undefined})) return false;
      setError(result.error ?? "");
      if (result.polished && record.current.dismissed !== result.requestId) setPolishedContent(result.polished);
      window.dispatchEvent(new Event("credit-balance-change"));
    }
    return true;
  }

  useEffect(() => {
    if (!open) return;
    let active = true, refreshing = false;
    const queryController = new AbortController();
    const initialize = async () => {
      // 会话存储属于浏览器外部状态；在异步初始化时清理上个文件的界面。
      await Promise.resolve();
      if (!active) return false;
      generation.current++;
      record.current = {content:initialContent};
      latestId.current = undefined;
      setReady(false); setBusy(false); setPending(false); setCreditCall(undefined);
      setPolishedContent(null); setError(""); setContent(initialContent);
      try {
        const saved = storageKey ? sessionStorage.getItem(storageKey) : null;
        if (saved) {
          const value: Draft = JSON.parse(saved);
          if ((value.content !== undefined && typeof value.content !== "string") || (value.pending && (typeof value.pending.content !== "string" || typeof value.pending.requestId !== "string"))) throw Error("draft-invalid");
          record.current = value;
          setContent(value.content ?? initialContent); setPending(!!value.pending);
        }
        return true;
      } catch { setError("无法读取润色草稿，请检查浏览器会话存储后重新打开文件。"); return false; }
    };
    const refresh = async () => {
      if (!path || !storageKey || refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      const revision = generation.current;
      try {
        const key = record.current.pending?.requestId;
        const response = await fetch(path+(key ? "?requestId="+encodeURIComponent(key) : ""),{cache:"no-store",signal:queryController.signal});
        if (!response.ok) throw Error("润色记录暂时无法查询，请稍后重试。");
        const result: PolishResult = await response.json();
        if (active && revision === generation.current) setReady(receive(result));
      } catch (caught) { if (active && revision === generation.current) setError(caught instanceof Error ? caught.message : "润色记录查询失败"); }
      finally { refreshing = false; }
    };
    let initialized = false;
    void initialize().then(ok => { initialized = ok; if (ok) void refresh(); });
    const timer = window.setInterval(() => { if (initialized) void refresh(); },3000);
    window.addEventListener("focus",refresh);
    return () => { active = false; queryController.abort(); controller.current?.abort(); controller.current = null; sending.current = false; window.clearInterval(timer); window.removeEventListener("focus",refresh); };
    // 生命周期只跟随账号和文件；草稿及原请求通过 ref 读取，避免编辑导致取消请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,path,storageKey]);

  function edit(value: string) {
    setContent(value);
    if (storageKey && ready) persist({...record.current,content:value});
  }
  async function polish() {
    if (!ready || !path || !content.trim() || sending.current) return;
    const operation = record.current.pending ?? {requestId:crypto.randomUUID(),content};
    if (!persist({...record.current,content,pending:operation})) return;
    generation.current++;
    sending.current = true; setBusy(true); setCreditCall(undefined); setError(""); setPolishedContent(null);
    const requestController = new AbortController(); controller.current = requestController;
    try {
      const response = await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(operation),signal:requestController.signal});
      const result = await readGenerationResult(response);
      if (controller.current === requestController) receive(result);
    } catch (caught) {
      if (controller.current !== requestController) return;
      if (caught instanceof GenerationResultError) {
        receive(caught.result);
        // 明确未获准的操作才可释放原身份；500、网络错误及409均保留原key。
        if (!caught.result.state && [400,402,403,404,429].includes(caught.status)) persist({...record.current,pending:undefined});
      }
      setError(caught instanceof Error ? caught.message : "润色结果未确认，请重试原请求。");
      setBusy(false);
    } finally { if (controller.current === requestController) { sending.current = false; controller.current = null; } window.dispatchEvent(new Event("credit-balance-change")); }
  }
  async function stop() {
    const requestId = record.current.pending?.requestId ?? latestId.current;
    if (!path || !requestId) return;
    const revision = generation.current;
    try {
      const response = await fetch(path,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId})});
      const result = await response.json();
      if (revision !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "停止请求未确认，请重试停止。");
      receive(result);
    } catch (caught) { if (revision === generation.current) setError(caught instanceof Error ? caught.message : "停止请求未确认，请重试停止。"); }
  }
  function dismiss(apply: boolean) {
    const value = apply && polishedContent ? polishedContent : content;
    setContent(value); setPolishedContent(null);
    persist({...record.current,content:value,dismissed:latestId.current});
  }
  function saved() {
    // 成功保存后只清正文草稿，费用及不采用选择仍可恢复；未知请求保留原输入。
    if (storageKey && !record.current.pending) persist({...record.current,content:undefined});
  }
  return {content,edit,polishedContent,creditCall,error,busy,ready,pending,polish,stop,dismiss,saved};
}
