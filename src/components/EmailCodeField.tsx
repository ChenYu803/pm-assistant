"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EmailCodeFieldProps = {
  email: string;
  purpose: "register" | "reset-password";
  value: string;
  onChange: (value: string) => void;
};

export default function EmailCodeField({ email, purpose, value, onChange }: EmailCodeFieldProps) {
  const [until, setUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);

  async function send() {
    setSending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/auth/email-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose }),
      });
      const data = await response.json();
      if (data.retryAfter) setUntil(Date.now() + data.retryAfter * 1000);
      if (!response.ok) {
        setError(data.error || "发送失败，请稍后重试。");
        return;
      }
      setMessage(data.message);
      onChange("");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <Label htmlFor="emailCode" className="mb-1 block">邮箱验证码</Label>
      <div className="flex gap-2">
        <Input
          id="emailCode"
          value={value}
          onChange={event => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          placeholder="6 位数字"
          required
          aria-describedby="email-code-note"
        />
        <Button
          type="button"
          variant="outline"
          onClick={send}
          disabled={sending || remaining > 0 || !email.trim()}
          className="shrink-0"
        >
          {sending ? "发送中…" : remaining > 0 ? remaining + " 秒后重发" : "获取验证码"}
        </Button>
      </div>
      <p id="email-code-note" className="mt-1 text-sm text-muted-foreground">
        10 分钟内有效；重新发送后仅最新验证码有效。
      </p>
      {message && <p role="status" className="mt-1 text-sm text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="mt-1 text-sm">{error}</p>}
    </div>
  );
}
