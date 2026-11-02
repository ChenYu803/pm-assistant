"use client";

import { useState } from "react";
import Link from "next/link";
import EmailCodeField from "@/components/EmailCodeField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "重置失败，请稍后重试。");
        return;
      }
      setDone(true);
      setPassword("");
      setConfirm("");
      setCode("");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-2xl font-bold">找回密码</h1>
        {done ? <p role="status">密码已重置，请使用新密码登录。</p> : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="mb-1 block">邮箱</Label>
              <Input id="email" type="email" autoComplete="email" value={email}
                onChange={event => { setEmail(event.target.value); setCode(""); }} required />
            </div>
            <EmailCodeField email={email} purpose="reset-password" value={code} onChange={setCode} />
            <div>
              <Label htmlFor="password" className="mb-1 block">新密码</Label>
              <Input id="password" type="password" minLength={6} autoComplete="new-password"
                value={password} onChange={event => setPassword(event.target.value)} required placeholder="至少 6 位密码" />
            </div>
            <div>
              <Label htmlFor="confirmPassword" className="mb-1 block">确认新密码</Label>
              <Input id="confirmPassword" type="password" minLength={6} autoComplete="new-password"
                value={confirm} onChange={event => setConfirm(event.target.value)} required />
            </div>
            {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">{loading ? "重置中…" : "重置密码"}</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link className="underline" href="/login">返回登录</Link>
        </p>
      </div>
    </div>
  );
}
