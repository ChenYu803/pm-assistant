/** 只允许回到本站的绝对路径，拒绝协议相对路径、反斜杠和控制字符。 */
export function safeCallbackUrl(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "http://localhost");
    return parsed.origin === "http://localhost" ? value : fallback;
  } catch {
    return fallback;
  }
}
