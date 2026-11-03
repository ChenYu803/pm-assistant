// 外部邮件边界替身：只监听随机本机端口，控制口令由隔离 launcher 创建。
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
export async function startEmailFixture() {
 const token = randomBytes(32).toString("hex");
 const messages = []; let offset = 0; let mode = "success";
 const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(403).end("{}"); return; }
  try {
   let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw Error("too large"); }
   const body = raw ? JSON.parse(raw) : {};
   if (request.url === "/clock") return response.end(JSON.stringify({ now: Date.now() + offset }));
   if (request.url === "/clock-reset" && request.method === "POST") { offset = 0; return response.end("{}"); }
   if (request.url === "/advance" && request.method === "POST") { if (!Number.isInteger(body.seconds) || body.seconds < 0 || body.seconds > 3600) throw Error(); offset += body.seconds * 1000; return response.end("{}"); }
   if (request.url === "/mode" && request.method === "POST") { mode = body.mode; return response.end("{}"); }
   if (request.url === "/messages") return response.end(JSON.stringify(messages));
   if (request.url === "/send" && request.method === "POST") {
    if (mode === "failure") { response.writeHead(503).end("{}"); return; }
    if (!/^[0-9]{6}$/.test(body.code) || !["register", "reset-password"].includes(body.purpose)) throw Error();
    messages.push(body); response.end(JSON.stringify({ accepted: true })); return;
   }
   response.writeHead(404).end("{}");
  } catch { response.writeHead(400).end("{}"); }
 });
 await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
 return { url: "http://127.0.0.1:" + server.address().port, token, close: () => new Promise(resolve => server.close(resolve)) };
}
export async function fixtureRequest(path, body) {
 if (!process.env.V144_EMAIL_TEST_URL || !process.env.V144_EMAIL_TEST_TOKEN || !/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "")) throw Error("邮件观察器必须在隔离环境运行");
 const response = await fetch(process.env.V144_EMAIL_TEST_URL + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + process.env.V144_EMAIL_TEST_TOKEN, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
 if (!response.ok) throw Error("邮件替身控制请求失败");
 return response.json();
}
export async function latestEmailCode(email, purpose = "register") {
 const messages = await fixtureRequest("/messages");
 const message = messages.filter(item => item.email === email.trim().toLowerCase() && item.purpose === purpose).at(-1);
 if (!message) throw Error("隔离邮件尚未收到");
 return message.code;
}
export async function requestRegistrationCode(client, email) {
 const response = await client.post(process.env.BASE_URL + "/api/auth/email-code", { data: { email, purpose: "register" } });
 if (response.status() !== 200) throw Error("申请隔离注册验证码失败，HTTP " + response.status());
 return latestEmailCode(email);
}
