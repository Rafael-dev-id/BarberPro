export const MAX_BOOKING_DAYS = 14;
export const LATE_GRACE_MINUTES = 10;
export const CANCEL_WINDOW_MINUTES = 30;
export const SLOT_INTERVAL_MINUTES = 15;

const JAKARTA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
   timeZone: "Asia/Jakarta",
});
const JAKARTA_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
   timeZone: "Asia/Jakarta",
   hour: "2-digit",
   minute: "2-digit",
   hourCycle: "h23",
});
let cachedJakartaSecond = -1;
let cachedJakartaNow: { date: string; minutes: number } | null = null;

export function timeToMinutes(time: string): number {
   const [hours, minutes] = time.split(":").map(Number);
   return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
   const h = Math.floor(minutes / 60);
   const m = minutes % 60;
   const hh = String(h).padStart(2, "0");
   const mm = String(m).padStart(2, "0");
   return `${hh}:${mm}`;
}

export function getJakartaNow(): { date: string; minutes: number } {
   const nowMs = Date.now();
   const currentSecond = Math.floor(nowMs / 1000);
   if (cachedJakartaSecond === currentSecond && cachedJakartaNow) {
      return cachedJakartaNow;
   }

   const now = new Date(nowMs);
   const date = JAKARTA_DATE_FORMATTER.format(now);
   const parts = JAKARTA_TIME_FORMATTER.formatToParts(now);
   const minutes =
      Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
      Number(parts.find((part) => part.type === "minute")?.value ?? 0);

   cachedJakartaSecond = currentSecond;
   cachedJakartaNow = { date, minutes };
   return cachedJakartaNow;
}

export function effectiveStart(
   slot: number,
   nowMinutes: number,
   isToday: boolean
): number {
   return isToday ? Math.max(slot, nowMinutes) : slot;
}

export function generateSlots(
   startMinutes: number,
   endMinutes: number,
   durationMinutes: number,
   intervalMinutes: number = SLOT_INTERVAL_MINUTES
): number[] {
   const slots: number[] = [];

   for (
      let current = startMinutes;
      current + durationMinutes <= endMinutes; 
      current += intervalMinutes
   ) {
      slots.push(current);
   }

   return slots;
}

export function filterPastSlots(slots: number[], dateStr: string): number[] {
   const { date: today, minutes: nowMinutes } = getJakartaNow();

   if (dateStr !== today) return slots;

   return slots.filter((slot) => slot > nowMinutes - LATE_GRACE_MINUTES);
}

export function isTooCloseToCancel(
   startsAtIso: string,
   nowMs: number = Date.now()
): boolean {
   return (
      nowMs >=
      new Date(startsAtIso).getTime() - CANCEL_WINDOW_MINUTES * 60_000
   );
}