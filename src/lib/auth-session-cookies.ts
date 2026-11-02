// 只读鉴权不得重新签发浏览器会话，否则退出前的迟到响应会恢复已清除的 Cookie。
// 登录签发仍由 NextAuth 负责；空值清除、CSRF 及其他 Cookie 均保持原样。
export function withoutSessionRenewal(response: Response): Response {
  const cookies = response.headers.getSetCookie();
  const preserved = cookies.filter((cookie) => !/^(?:__Secure-)?authjs\.session-token(?:\.\d+)?=[^;]/i.test(cookie));
  if (preserved.length === cookies.length) return response;
  response.headers.delete("set-cookie");
  for (const cookie of preserved) response.headers.append("set-cookie", cookie);
  return response;
}
