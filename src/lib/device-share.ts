import { commercialDescription, type Device } from "./devices";
import { formatBRL } from "./money";

type CommercialDevice = Pick<Device, "model" | "storage" | "color" | "condition" | "battery_health" | "sale_price">;

/** Allowlist commercial fields; never serialize the full device into a share. */
export function deviceShareText(device: CommercialDevice, includeDescription: boolean, includePrice: boolean) {
  const parts: string[] = [];
  const omitted: string[] = [];
  if (includeDescription) {
    if (device.model.trim()) parts.push(commercialDescription(device, false, formatBRL));
    else omitted.push("Descrição comercial não cadastrada; será omitida.");
  }
  if (includePrice) {
    if (device.sale_price != null && String(device.sale_price).trim() !== "") parts.push(formatBRL(device.sale_price));
    else omitted.push("Preço de venda não cadastrado; será omitido.");
  }
  return { text: parts.join("\n"), omitted };
}