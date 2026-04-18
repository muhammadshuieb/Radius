/** Current calendar date YYYY-MM-DD in the given IANA timezone. */
export function calendarDateInTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function getNowPartsInTz(timeZone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  let hour = parseInt(parts.find((x) => x.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((x) => x.type === "minute")?.value ?? "0", 10);
  if (hour === 24) hour = 0;
  return { hour, minute };
}
