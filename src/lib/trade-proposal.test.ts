import {describe,it,expect} from "vitest";
import {proposalText,tradeDifference,proposalWhatsApp} from "./trade-proposal";
describe("trade proposals",()=>{
 it("5800 minus 1800 leaves 4000 payable",()=>expect(tradeDifference(580000,180000)).toBe(400000));
 it("higher used value gives customer a credit",()=>expect(tradeDifference(150000,180000)).toBe(-30000));
 it("flags absent inventory and only shares commercial fields",()=>{const text=proposalText({used:"iPhone 11",offered:180000,desired:"iPhone 16",price:580000,available:false});expect(text).toContain("Disponibilidade a confirmar");expect(text).toContain("4.000,00");});
 it("opens the registered phone with an encoded draft",()=>expect(proposalWhatsApp("proposta", "11987654321")).toBe("https://wa.me/5511987654321?text=proposta"));
});