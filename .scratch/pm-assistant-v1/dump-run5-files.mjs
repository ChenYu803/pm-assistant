// 诊断工具（一次性，不入库）：提取最近一次 verify-flow 运行的 需求分析.md/原型.md/prd.md
// 用法: node .scratch/pm-assistant-v1/dump-runX-files.mjs
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
await mongoose.connect(env.MONGODB_URI);
const db = mongoose.connection.db;

const users = await db.collection("users").find({ email: /^verify-flow-/ }).sort({ created_at: -1 }).skip(parseInt(process.argv[2] ?? "0", 10)).limit(1).toArray();
if (!users.length) { console.log("NO verify-flow user found"); process.exit(0); }
const user = users[0];
console.log("user:", user.email);

const proj = await db.collection("projects").find({ user_id: user._id }).sort({ created_at: -1 }).limit(1).toArray();
if (!proj.length) { console.log("no project"); process.exit(0); }
const wrs = await db.collection("work_records").find({ project_id: proj[0]._id }).sort({ created_at: -1 }).limit(1).toArray();
if (!wrs.length) { console.log("no work record"); process.exit(0); }
const wr = wrs[0];
console.log("work_record:", wr._id);

const files = await db.collection("project_files").find({ project_id: wr.project_id }).toArray();
for (const f of files) {
  const safe = f.filename.replace(/[\\/:*?"<>|]/g, "_");
  fs.writeFileSync(path.join(__dirname, "runX-files", safe), f.content ?? "");
  console.log(`saved: ${f.filename}`);
}
process.exit(0);
