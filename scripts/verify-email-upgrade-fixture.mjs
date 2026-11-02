// 仅构造本次空库的上一版结构与资料；升级由正式 initializeMysql 完成。
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { MYSQL_MIGRATIONS } from "../src/lib/mysql-bootstrap.ts";
export async function seedLegacyEmailUpgrade(admin, database) {
 if (!/^v141_replay_[a-f0-9]{16}$/.test(database)) throw Error("拒绝在非随机隔离库准备升级资料");
 await admin.query("USE \x60" + database + "\x60");
 await admin.query("CREATE TABLE schema_migrations (id VARCHAR(128) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
 for (const migration of MYSQL_MIGRATIONS) {
  if (migration.id === "0024_v144_email_verification") break;
  for (const statement of migration.statements) await admin.query(statement);
  await admin.execute("INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)", [migration.id, migration.checksum]);
 }
 const id = randomUUID(); const projectId = randomUUID(); const fileId = randomUUID();
 const email = "legacy-" + randomUUID() + "@test.local"; const password = randomBytes(48).toString("hex");
 await admin.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)", [id, email, await bcrypt.hash(password, 12)]);
 await admin.execute("INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)", [projectId, id, "升级前项目"]);
 await admin.execute("INSERT INTO project_files (id, project_id, filename, content) VALUES (?, ?, ?, ?)", [fileId, projectId, "升级前资料.md", "升级前原始资料，不应被邮箱验证升级覆盖。"]);
 return { V144_LEGACY_EMAIL: email, V144_LEGACY_PASSWORD: password, V144_LEGACY_PROJECT_ID: projectId, V144_LEGACY_FILE_ID: fileId };
}
