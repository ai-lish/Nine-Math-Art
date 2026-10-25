export function rational(numerator, denominator = 1n) {
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d === 0n) return null;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n < 0n ? -n : n, d);
  return { n: n / divisor, d: d / divisor };
}

function gcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

export function add(a, b) {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subtract(a, b) {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function multiply(a, b) {
  return rational(a.n * b.n, a.d * b.d);
}

export function divide(a, b) {
  if (b.n === 0n) return null;
  return rational(a.n * b.d, a.d * b.n);
}

export function compare(a, b) {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function sameValue(a, b) {
  return Boolean(a && b && a.n === b.n && a.d === b.d);
}

export function parseRational(input) {
  const value = String(input ?? "").trim();
  if (!value) return null;
  const mixed = value.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = BigInt(mixed[1]);
    const part = BigInt(mixed[2]);
    const denominator = BigInt(mixed[3]);
    if (denominator === 0n || part >= denominator) return null;
    const direction = whole < 0n ? -1n : 1n;
    return rational(whole * denominator + direction * part, denominator);
  }
  const fraction = value.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) return rational(BigInt(fraction[1]), BigInt(fraction[2]));
  const decimal = value.match(/^(-?\d+)(?:\.(\d+))?$/);
  if (decimal) {
    const digits = decimal[2] ?? "";
    return rational(BigInt(`${decimal[1]}${digits}`), 10n ** BigInt(digits.length));
  }
  return null;
}

export function rationalString(value) {
  return value.d === 1n ? String(value.n) : `${value.n}/${value.d}`;
}

export function formatRational(value) {
  const whole = value.n / value.d;
  const remainder = value.n % value.d;
  if (remainder === 0n) return String(whole);
  if (whole === 0n) return `${remainder}/${value.d}`;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  return `${whole} 又 ${absoluteRemainder}/${value.d}`;
}

export function calculateArea(techniqueId, parameters) {
  const p = Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, parseRational(value)]));
  if (Object.values(p).some((value) => !value)) return null;
  if (techniqueId === "fangtian") return multiply(p.width, p.length);
  if (techniqueId === "litian") {
    const mu = multiply(multiply(p.width, p.length), rational(375n));
    return multiply(mu, rational(240n));
  }
  if (techniqueId === "guitian") return divide(multiply(p.width, p.height), rational(2n));
  if (techniqueId === "xietian") {
    return divide(multiply(add(p.endA, p.endB), p.height), rational(2n));
  }
  if (techniqueId === "jitian") {
    return divide(multiply(add(p.tongue, p.heel), p.height), rational(2n));
  }
  return null;
}

export function parseAreaAnswer({ qing = "", mu = "", bu = "" }) {
  const fields = [qing, mu, bu];
  if (fields.every((field) => String(field).trim() === "")) return null;
  const parsed = fields.map((field) => String(field).trim() ? parseRational(field) : rational(0n));
  if (parsed.some((value) => !value)) return null;
  return add(add(multiply(parsed[0], rational(100n * 240n)), multiply(parsed[1], rational(240n))), parsed[2]);
}

export function areaInMu(squareBu) {
  return divide(squareBu, rational(240n));
}

export function seededRandom(seedText) {
  let seed = 2166136261;
  for (const character of String(seedText)) {
    seed ^= character.codePointAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateParameters(techniqueId, random, originalProblems = []) {
  const originalKeys = new Set(originalProblems.map((problem) => parameterKey(problem.parameters)));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pick = (low, high) => low + Math.floor(random() * (high - low + 1));
    let parameters;
    if (techniqueId === "fangtian") {
      parameters = { width: String(pick(8, 30)), length: String(pick(8, 30)) };
    } else if (techniqueId === "litian") {
      parameters = { width: String(pick(1, 5)), length: String(pick(1, 5)) };
    } else if (techniqueId === "guitian") {
      parameters = { width: String(pick(3, 15) * 2), height: String(pick(8, 30)) };
    } else if (techniqueId === "xietian") {
      const endA = pick(8, 40);
      const endB = pick(8, 40);
      const height = pick(8, 30);
      if ((endA + endB) % 2 !== 0 && height % 2 !== 0) continue;
      parameters = { endA: String(endA), endB: String(endB), height: String(height) };
    } else if (techniqueId === "jitian") {
      const tongue = pick(8, 40);
      const heel = pick(6, 30);
      const height = pick(8, 30);
      if ((tongue + heel) % 2 !== 0 && height % 2 !== 0) continue;
      parameters = { tongue: String(tongue), heel: String(heel), height: String(height) };
    } else {
      return null;
    }
    if (!originalKeys.has(parameterKey(parameters))) return parameters;
  }
  return null;
}

function parameterKey(parameters) {
  return Object.keys(parameters).sort().map((key) => `${key}:${rationalString(parseRational(parameters[key]))}`).join("|");
}
