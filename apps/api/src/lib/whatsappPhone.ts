/** WAHA chatId uses digits only + @c.us (country code without +). */
export function normalizePhoneToChatId(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `${digits}@c.us`;
}
