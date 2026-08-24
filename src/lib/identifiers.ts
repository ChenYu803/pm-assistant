export const MYSQL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** v1.3 起 API、URL 与关系表共同使用的公开标识符。 */
export function isMysqlId(value: string): boolean {
  return MYSQL_ID_RE.test(value);
}
