// Monetary values travel as decimal strings (numeric(12,2)) and are summed as integer cents
// to avoid floating-point drift.

/** Parse a BRL user input ("1.234,56", "1234.56", "R$ 10") into integer cents. */
export function parseBRLToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).replace(/R\$|\s/g, "").trim();
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(".");
  return Number(int) * 100 + Number((dec + "00").slice(0, 2));
}

/** Convert a DB numeric (string or number) to integer cents. */
export function toCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const s = typeof value === "number" ? value.toFixed(2) : value;
  const neg = s.startsWith("-");
  const [int, dec = ""] = s.replace("-", "").split(".");
  const cents = Number(int) * 100 + Number((dec + "00").slice(0, 2));
  return neg ? -cents : cents;
}

export function centsToDecimal(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

export function formatBRL(value: string | number | null | undefined): string {
  return formatCents(toCents(value));
}

/** Format cents for an input field ("1234,56"). */
export function centsToInput(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function sumCents(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + toCents(v), 0);
}
