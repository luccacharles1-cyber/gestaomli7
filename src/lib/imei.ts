export function normalizeImei(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\D/g, "");
  return s.length ? s : null;
}

/** IMEI: 15 digits with a valid Luhn check digit. */
export function isValidImei(v: string): boolean {
  if (!/^\d{15}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(v[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Returns an error message, or null when the pair is acceptable. */
export function validateImeiPair(imei1: string | null, imei2: string | null): string | null {
  if (imei1 && !isValidImei(imei1)) return "IMEI 1 inválido (15 dígitos com dígito verificador).";
  if (imei2 && !isValidImei(imei2)) return "IMEI 2 inválido (15 dígitos com dígito verificador).";
  if (imei1 && imei2 && imei1 === imei2) return "IMEI 1 e IMEI 2 não podem ser iguais.";
  return null;
}
