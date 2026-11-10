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

// Keep the stored slot range intact and estimate the session from its real start.
export function minutesPastEnd(endsAtIso: string, nowMs: number): number {
  return Math.max(
    0,
    Math.floor((nowMs - new Date(endsAtIso).getTime()) / 60_000)
  );
}

export function getSessionTimes(booking: {
  starts_at: string;
  ends_at: string;
  started_at?: string | null;
  services?: { duration?: number } | null;
}): { startedAt: string; estimatedEndAt: string | null } {
  const startedAt = booking.started_at ?? booking.starts_at;
  const storedRangeDurationMs =
    new Date(booking.ends_at).getTime() -
    new Date(booking.starts_at).getTime();
  const durationMs =
    typeof booking.services?.duration === "number" &&
    Number.isFinite(booking.services.duration) &&
    booking.services.duration > 0
      ? booking.services.duration * 60_000
      : storedRangeDurationMs > 0
        ? storedRangeDurationMs
        : null;

  return {
    startedAt,
    estimatedEndAt:
      durationMs === null
        ? null
        : new Date(new Date(startedAt).getTime() + durationMs).toISOString(),
  };
}

export function findRunningSessions<
  T extends { id: number; status: string; starts_at: string; ends_at: string },
>(
  bookings: T[],
  isSameBarber: (booking: T) => boolean,
  nowMs: number
): T[] {
  return bookings
    .filter(
      (booking) =>
        booking.status === "started" &&
        isSameBarber(booking) &&
        ["in_session", "overtime", "stale_session", "future_session"].includes(
          getRowState(booking, nowMs)
        )
    )
    .sort(
      (left, right) =>
        new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
    );
}

export function getRowState(
  booking: {
    status: string;
    starts_at: string;
    ends_at: string;
    started_at?: string | null;
  },
  nowMs: number
): RowState {
  if (booking.status === "done") return "done";
  if (booking.status === "cancelled") return "cancelled";

  const sessionTimes =
    booking.status === "started" ? getSessionTimes(booking) : null;
  const bookingDate = jakartaDateKey(sessionTimes?.startedAt ?? booking.starts_at);
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
      if (!sessionTimes?.estimatedEndAt) return "in_session";
      return nowMs >
        new Date(sessionTimes.estimatedEndAt).getTime() +
          OVERDUE_GRACE_MINUTES * 60_000
        ? "overtime"
        : "in_session";
    }
    return bookingDate < today ? "stale_session" : "future_session";
  }

  return "other";
}
