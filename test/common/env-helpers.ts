export function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  return BigInt(raw);
}

export function envBigIntArray(name: string, fallback: bigint[]): bigint[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((v) => BigInt(v.trim()))
    .filter((v) => v > 0n);
}
