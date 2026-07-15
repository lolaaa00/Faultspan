const WEI_PER_GEN = 10n ** 18n;

export function formatGen(value: bigint | string | number | null | undefined, digits = 6) {
  const wei = normalizeWei(value);
  const negative = wei < 0n;
  const absolute = negative ? -wei : wei;
  const whole = absolute / WEI_PER_GEN;
  const fraction = absolute % WEI_PER_GEN;
  const fractionText = fraction.toString().padStart(18, "0").slice(0, digits).replace(/0+$/u, "");
  const amount = fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
  return `${negative ? "-" : ""}${amount} GEN`;
}

function normalizeWei(value: bigint | string | number | null | undefined) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return BigInt(value.trim());
  return 0n;
}
