/** 邮件/时间替身只允许随机隔离账号、空库回放与本机服务同时成立。 */

export function emailTestBoundary() {
  const value = process.env.V144_EMAIL_TEST_URL;
  if (!value)
    return null;
  const suffix = /^v141_replay_([a-f0-9]{16})$/.exec(process.env.MYSQL_DATABASE ?? "")?.[1];
  const provider = process.env.V144_PROVIDER_FIXTURE_URL;
  const localProvider = process.env.AI_MODE === "live"
    && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(provider ?? "")
    && process.env.AI_BASE_URL === provider
    && process.env.AI_API_KEY === "isolated-provider-fixture";
  if (process.env.NODE_ENV !== "development" || (process.env.AI_MODE !== "replay" && !localProvider) || !suffix || process.env.MYSQL_USER !== "v141_test_" + suffix || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value) || (process.env.V144_EMAIL_TEST_TOKEN?.length ?? 0) < 32)
    throw new Error("拒绝在非隔离环境启用邮件替身");
  return { url: value, token: process.env.V144_EMAIL_TEST_TOKEN! };
}

export async function emailNow() {
  const test = emailTestBoundary();
  if (!test)
    return new Date();
  const response = await fetch(test.url + "/clock", { headers: { authorization: "Bearer " + test.token }, signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!response.ok)
    throw new Error("隔离时钟不可用");
  const { now } = await response.json();
  const date = new Date(now);
  if (!Number.isFinite(date.getTime()))
    throw new Error("隔离时钟无效");
  return date;
}
