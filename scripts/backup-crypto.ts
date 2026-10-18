import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, appendFile, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("ISB1");

export async function fileSha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** AES-256-GCM：格式头 + 12 字节随机 IV + 密文 + 16 字节认证标签。 */
export async function encryptBackup(input: string, output: string, key: Buffer) {
  if (key.length !== 32) throw new Error("备份密钥必须恰为 32 字节");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const file = await open(output, "wx", 0o600);
  try {
    await file.write(Buffer.concat([MAGIC, iv]));
    await file.close();
    await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }));
    await appendFile(output, cipher.getAuthTag());
  } catch (error) { await file.close().catch(() => undefined); await unlink(output).catch(() => undefined); throw error; }
}

export async function decryptBackup(input: string, output: string, key: Buffer) {
  const size = (await stat(input)).size;
  if (key.length !== 32 || size < 33) throw new Error("备份密钥或格式不合法");
  const file = await open(input, "r");
  const header = Buffer.alloc(16);
  const tag = Buffer.alloc(16);
  try {
    await file.read(header, 0, 16, 0);
    await file.read(tag, 0, 16, size - 16);
  } finally { await file.close(); }
  if (!header.subarray(0, 4).equals(MAGIC)) throw new Error("备份格式不合法");
  const cipher = createDecipheriv("aes-256-gcm", key, header.subarray(4));
  cipher.setAAD(MAGIC);
  cipher.setAuthTag(tag);
  const outputFile = await open(output, "wx", 0o600);
  await outputFile.close();
  try { await pipeline(createReadStream(input, { start: 16, end: size - 17 }), cipher, createWriteStream(output, { flags: "w", mode: 0o600 })); }
  catch (error) { await unlink(output).catch(() => undefined); throw error; }
}
