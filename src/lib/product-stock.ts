export function stockAdjustment(previous: number, next: number, reason: string) {
  if (!Number.isSafeInteger(next) || next < 0) throw new Error("Informe um saldo inteiro não negativo.");
  if (!reason.trim()) throw new Error("Informe o motivo do ajuste.");
  return { previous_quantity: previous, quantity: next, reason: reason.trim(), delta: next - previous };
}

export function canDeleteProduct(quantity: number, hasHistory: boolean) {
  return quantity === 0 && !hasHistory;
}