export const OVERDUE_GRACE_MINUTES = 15;

const JAKARTA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
});

export type RowState =
  | "upcoming"
  | "today"
  | "overdue"
  | "in_session"
  | "overtime"
  | "stale_session"
  | "future_session"
  | "done"
  | "cancelled"
  | "other";

export function jakartaDateKey(input: string | number | Date): string {
  return JAKARTA_DATE_FORMATTER.format(new Date(input));
}

// Dasar hitungan = ends_at; beralih ke started_at bila kolom itu ada.
export function minutesPastEnd(endsAtIso: string, nowMs: number): number {
  return Math.max(
    0,
    Math.floor((nowMs - new Date(endsAtIso).getTime()) / 60_000)
  );
}

export function getRowState(
  booking: { status: string; starts_at: string; ends_at: string },
  nowMs: number
): RowState {
  if (booking.status === "done") return "done";
  if (booking.status === "cancelled") return "cancelled";

  const bookingDate = jakartaDateKey(booking.starts_at);
  const today = jakartaDateKey(nowMs);

  if (booking.status === "confirmed") {
    if (bookingDate > today) return "upcoming";
    if (bookingDate < today) return "overdue";
    return nowMs > new Date(booking.ends_at).getTime() + OVERDUE_GRACE_MINUTES * 60_000
      ? "overdue"
      : "today";
  }

  if (booking.status === "started") {
    if (bookingDate === today) {
      return nowMs >
        new Date(booking.ends_at).getTime() + OVERDUE_GRACE_MINUTES * 60_000
        ? "overtime"
        : "in_session";
    }
    return bookingDate < today ? "stale_session" : "future_session";
  }

  return "other";
}
