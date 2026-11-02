export function positiveSetting(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} 必须为正整数`);
  return value;
}
