"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { z } from "zod";
import {
   sendWhatsAppToCustomer,
   buildCustomerBookingMessage,
   buildCustomerStatusMessage,
} from "@/lib/whatsapp";
import { isValidIndonesianPhone, normalizePhone } from "@/lib/phone";
import { formatTanggalLabel, formatTanggalPanjang } from "@/lib/format";
import {
   getSessionTimes,
   jakartaDateKey,
   OVERDUE_GRACE_MINUTES,
} from "@/lib/booking-state";
import {
   getJakartaNow,
   timeToMinutes,
} from "@/lib/slots";
import { STORE } from "@/lib/data";
import {
   isNetworkError,
   NETWORK_ERROR_MESSAGE,
   requireAdminUser,
} from "@/lib/admin-auth";

const statusSchema = z.enum(["confirmed", "started", "done", "cancelled"]);
const activeBookingStatuses = ["pending", "confirmed", "started"] as const;
const SLOT_INTERVAL_MS = 15 * 60_000;

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type ActiveBooking = {
   id: number;
   barber_id: number;
   customer_name: string;
   status: string;
   starts_at: string;
   ends_at: string;
   started_at: string | null;
   services?:
      | { duration?: number }
      | { duration?: number }[]
      | null;
};
type SchedulingBarber = { id: number; name: string };
type SchedulingHour = {
   barber_id: number;
   start_time: string;
   end_time: string;
};
type DaySchedulingContext = {
   barbers: SchedulingBarber[];
   hours: SchedulingHour[];
   bookings: ActiveBooking[];
   sessionsToday: ActiveBooking[];
   rankingHours: SchedulingHour[];
};
type BarberSlot = {
   barber: SchedulingBarber;
   startsAt: string;
   label: string;
};
type StartConflict = {
   barberName: string;
   customerName: string;
   time: string;
   kind: "running" | "booked";
   message: string;
   sessionId: number | null;
   canFinishFirst: boolean;
   suggestedBarber?: SchedulingBarber;
   nearestSlotSame?: BarberSlot;
   nearestSlotAny?: BarberSlot;
};

function jakartaMidnightMs(date: string): number {
   return new Date(`${date}T00:00:00+07:00`).getTime();
}

function estimatedSessionEnd(booking: ActiveBooking): string {
   const service = Array.isArray(booking.services)
      ? booking.services[0]
      : booking.services;
   return getSessionTimes({
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      started_at: booking.started_at,
      services: service,
   }).estimatedEndAt ?? booking.ends_at;
}

function jakartaWeekday(date: string): number {
   const [year, month, day] = date.split("-").map(Number);
   return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function timeLabel(value: string | number | Date): string {
   return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
   }).format(new Date(value));
}

function startWithinHours(
   hours: SchedulingHour[],
   barberId: number,
   date: string,
   startsAtMs: number
): boolean {
   const minutes = (startsAtMs - jakartaMidnightMs(date)) / 60_000;
   return hours.some(
      (hour) =>
         hour.barber_id === barberId &&
         minutes >= timeToMinutes(hour.start_time) &&
         minutes < timeToMinutes(hour.end_time)
   );
}

async function loadDayScheduling(
   supabase: ServerSupabaseClient,
   date: string,
   rangeStartMs: number,
   rangeEndMs: number,
   excludeBookingId?: number
): Promise<
   | { ok: true; context: DaySchedulingContext }
   | { ok: false; message: string }
> {
   const weekday = jakartaWeekday(date);
   const rankingDate = jakartaDateKey(Date.now());
   const rankingWeekday = jakartaWeekday(rankingDate);
   const [barbersResult, sessionsResult] = await Promise.all([
      supabase.from("barbers").select("id, name").eq("is_active", true),
      supabase
         .from("bookings")
         .select("id, barber_id, customer_name, status, starts_at, ends_at, started_at, services(duration)")
         .in("status", ["done", "started"])
         .gte(
            "starts_at",
            new Date(jakartaMidnightMs(rankingDate) - 24 * 60 * 60_000).toISOString()
         )
         .lt(
            "starts_at",
            new Date(jakartaMidnightMs(rankingDate) + 24 * 60 * 60_000).toISOString()
         ),
   ]);

   if (barbersResult.error || sessionsResult.error) {
      const error = barbersResult.error ?? sessionsResult.error;
      return {
         ok: false,
         message: error && isNetworkError(error)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa jadwal kapster. Silakan coba lagi.",
      };
   }

   const barbers = (barbersResult.data ?? []) as SchedulingBarber[];
   const barberIds = barbers.map((barber) => barber.id);
   const [hoursResult, bookingsResult, rankingHoursResult] = await Promise.all([
      barberIds.length > 0
         ? supabase
              .from("working_hours")
              .select("barber_id, start_time, end_time")
              .in("barber_id", barberIds)
              .eq("weekday", weekday)
         : Promise.resolve({ data: [], error: null }),
      supabase
         .from("bookings")
         .select("id, barber_id, customer_name, status, starts_at, ends_at, started_at, services(duration)")
         .in("status", [...activeBookingStatuses])
         .or(
            `and(starts_at.lt.${new Date(rangeEndMs).toISOString()},ends_at.gt.${new Date(rangeStartMs).toISOString()}),status.eq.started`
         ),
      rankingWeekday === weekday
         ? Promise.resolve({ data: [], error: null })
         : barberIds.length > 0
           ? supabase
                .from("working_hours")
                .select("barber_id, start_time, end_time")
                .in("barber_id", barberIds)
                .eq("weekday", rankingWeekday)
           : Promise.resolve({ data: [], error: null }),
   ]);

   if (hoursResult.error || bookingsResult.error || rankingHoursResult.error) {
      const error =
         hoursResult.error ?? bookingsResult.error ?? rankingHoursResult.error;
      return {
         ok: false,
         message: error && isNetworkError(error)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa ketersediaan kapster. Silakan coba lagi.",
      };
   }

   const bookings = ((bookingsResult.data ?? []) as ActiveBooking[]).filter(
      (booking) => booking.id !== excludeBookingId
   );
   return {
      ok: true,
      context: {
         barbers,
         hours: (hoursResult.data ?? []) as SchedulingHour[],
         bookings,
         sessionsToday: ((sessionsResult.data ?? []) as ActiveBooking[]).filter(
            (booking) =>
               jakartaDateKey(booking.started_at ?? booking.starts_at) === rankingDate
         ),
         rankingHours:
            rankingWeekday === weekday
               ? ((hoursResult.data ?? []) as SchedulingHour[])
               : ((rankingHoursResult.data ?? []) as SchedulingHour[]),
      },
   };
}

function hasRunningSession(
   context: DaySchedulingContext,
   barberId: number
): ActiveBooking | undefined {
   return context.bookings.find(
      (booking) =>
         booking.barber_id === barberId && booking.status === "started"
   );
}

function findOverlappingBooking(
   context: DaySchedulingContext,
   barberId: number,
   startsAtMs: number,
   endsAtMs: number
): ActiveBooking | undefined {
   return context.bookings.find(
      (booking) =>
         booking.barber_id === barberId &&
         new Date(booking.starts_at).getTime() < endsAtMs &&
         new Date(booking.ends_at).getTime() > startsAtMs
   );
}

function pickBarber(
   candidates: SchedulingBarber[],
   context: DaySchedulingContext
): SchedulingBarber | undefined {
   if (candidates.length === 0) return undefined;
   const candidateRank = (barber: SchedulingBarber) => {
      const sessions = context.sessionsToday.filter(
         (booking) =>
            booking.barber_id === barber.id &&
            (booking.status === "done" || booking.status === "started")
      );
      const completed = sessions.filter((booking) => booking.status === "done");
      const lastFinishedAt = completed.reduce(
         (latest, booking) =>
            Math.max(latest, new Date(booking.ends_at).getTime()),
         -Infinity
      );
      const shiftStart = context.rankingHours
         .filter((hour) => hour.barber_id === barber.id)
         .reduce(
            (earliest, hour) =>
               Math.min(earliest, timeToMinutes(hour.start_time)),
            Infinity
         );
      return {
         sessionCount: sessions.length,
         idleSince:
            lastFinishedAt === -Infinity
               ? jakartaMidnightMs(jakartaDateKey(Date.now())) +
                 (Number.isFinite(shiftStart) ? shiftStart : 24 * 60) * 60_000
               : lastFinishedAt,
      };
   };

   const ranked = candidates
      .map((barber) => ({ barber, ...candidateRank(barber) }))
      .sort(
         (left, right) =>
            left.sessionCount - right.sessionCount ||
            left.idleSince - right.idleSince
      );
   const best = ranked[0];
   const tied = ranked.filter(
      (item) =>
         item.sessionCount === best.sessionCount &&
         item.idleSince === best.idleSince
   );
   return tied[Math.floor(Math.random() * tied.length)]?.barber;
}

function findFreeBarbersAt(
   context: DaySchedulingContext,
   startsAtMs: number,
   durationMinutes: number,
   date: string,
   excludedBarberId?: number,
   excludeRunningSessions = true
): SchedulingBarber[] {
   const endsAtMs = startsAtMs + durationMinutes * 60_000;
   return context.barbers.filter(
      (barber) =>
         barber.id !== excludedBarberId &&
         startWithinHours(context.hours, barber.id, date, startsAtMs) &&
         (!excludeRunningSessions || !hasRunningSession(context, barber.id)) &&
         !findOverlappingBooking(context, barber.id, startsAtMs, endsAtMs)
   );
}

function findFreeBarbersNow(
   context: DaySchedulingContext,
   durationMinutes: number,
   nowMs: number,
   excludedBarberId?: number
): SchedulingBarber[] {
   return findFreeBarbersAt(
      context,
      nowMs,
      durationMinutes,
      jakartaDateKey(nowMs),
      excludedBarberId
   );
}

function nearestFreeSlot(
   context: DaySchedulingContext,
   barber: SchedulingBarber,
   durationMinutes: number,
   date: string,
   nowMs: number
): BarberSlot | undefined {
   let startsAtMs = Math.ceil(nowMs / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS;
   const dayEndMs = jakartaMidnightMs(date) + 24 * 60 * 60_000;
   while (startsAtMs < dayEndMs) {
      if (
         findFreeBarbersAt(
            context,
            startsAtMs,
            durationMinutes,
            date,
            undefined,
            false
         ).some(
            (candidate) => candidate.id === barber.id
         )
      ) {
         return {
            barber,
            startsAt: new Date(startsAtMs).toISOString(),
            label: timeLabel(startsAtMs),
         };
      }
      startsAtMs += SLOT_INTERVAL_MS;
   }
   return undefined;
}

function nearestFreeSlotAny(
   context: DaySchedulingContext,
   durationMinutes: number,
   date: string,
   nowMs: number,
   excludedBarberId?: number
): BarberSlot | undefined {
   let startsAtMs = Math.ceil(nowMs / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS;
   const dayEndMs = jakartaMidnightMs(date) + 24 * 60 * 60_000;
   while (startsAtMs < dayEndMs) {
      const barber = pickBarber(
         findFreeBarbersAt(
            context,
            startsAtMs,
            durationMinutes,
            date,
            excludedBarberId,
            false
         ),
         context
      );
      if (barber) {
         return {
            barber,
            startsAt: new Date(startsAtMs).toISOString(),
            label: timeLabel(startsAtMs),
         };
      }
      startsAtMs += SLOT_INTERVAL_MS;
   }
   return undefined;
}

function makeStartConflict(
   context: DaySchedulingContext,
   barber: SchedulingBarber,
   booking: ActiveBooking,
   kind: "running" | "booked",
   durationMinutes: number,
   nowMs: number,
   customerName: string,
   sourceBarber?: SchedulingBarber
): StartConflict {
   const time =
      kind === "running"
         ? timeLabel(estimatedSessionEnd(booking))
         : timeLabel(booking.starts_at);
   const message =
      kind === "running"
         ? `${barber.name} masih mengerjakan ${booking.customer_name} (sampai ${time}).`
         : `${barber.name} punya booking ${time} (${booking.customer_name}).`;
   const suggestedBarber = pickBarber(
      findFreeBarbersNow(context, durationMinutes, nowMs, barber.id),
      context
   );
   return {
      barberName: barber.name,
      customerName: booking.customer_name,
      time,
      kind,
      sessionId: kind === "running" ? booking.id : null,
      canFinishFirst:
         kind === "running" &&
         nowMs >
            new Date(estimatedSessionEnd(booking)).getTime() +
               OVERDUE_GRACE_MINUTES * 60_000,
      message: `${sourceBarber && sourceBarber.id !== barber.id ? `${sourceBarber.name} dipilih. ` : ""}${message}${
         suggestedBarber ? ` Mulai dengan ${suggestedBarber.name}?` : ""
      }`,
      suggestedBarber,
      nearestSlotSame: nearestFreeSlot(
         context,
         barber,
         durationMinutes,
         jakartaDateKey(nowMs),
         nowMs
      ),
      nearestSlotAny: suggestedBarber
         ? undefined
         : nearestFreeSlotAny(
              context,
              durationMinutes,
              jakartaDateKey(nowMs),
              nowMs,
              barber.id
           ),
   };
}

type StartRoutineResult =
   | { ok: true; barberChanged: boolean }
   | {
        ok: false;
        code: "early_confirmation";
        scheduleLabel: string;
        nowLabel: string;
     }
   | { ok: false; code: "conflict"; conflict: StartConflict }
   | { ok: false; message: string };

async function runBookingStart(
   supabase: ServerSupabaseClient,
   bookingId: number,
   confirmEarly: boolean,
   targetBarberId?: number
): Promise<StartRoutineResult> {
   const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, status, starts_at, barber_id, service_id, customer_name")
      .eq("id", bookingId)
      .maybeSingle();
   if (bookingError) {
      return {
         ok: false,
         message: isNetworkError(bookingError)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa booking. Silakan coba lagi.",
      };
   }
   if (!booking) return { ok: false, message: "Booking tidak ditemukan." };
   if (booking.status !== "confirmed") {
      return { ok: false, message: "Booking ini bukan lagi berstatus dikonfirmasi." };
   }

   const [serviceResult, sourceBarberResult] = await Promise.all([
      supabase.from("services").select("duration").eq("id", booking.service_id).single(),
      supabase.from("barbers").select("id, name").eq("id", booking.barber_id).single(),
   ]);
   if (serviceResult.error || sourceBarberResult.error) {
      const error = serviceResult.error ?? sourceBarberResult.error;
      return {
         ok: false,
         message: error && isNetworkError(error)
            ? NETWORK_ERROR_MESSAGE
            : "Layanan atau kapster tidak ditemukan.",
      };
   }

   const nowMs = Date.now();
   const today = jakartaDateKey(nowMs);
   if (jakartaDateKey(booking.starts_at) !== today) {
      return { ok: false, message: "Hanya booking hari ini yang bisa dimulai." };
   }
   const duration = serviceResult.data.duration;
   const startsAtMs = nowMs;
   const endsAtMs = startsAtMs + duration * 60_000;
   const targetId = targetBarberId ?? booking.barber_id;
   const dayStartMs = jakartaMidnightMs(today);
   const contextResult = await loadDayScheduling(
      supabase,
      today,
      nowMs - 24 * 60 * 60_000,
      dayStartMs + 24 * 60 * 60_000 + duration * 60_000,
      bookingId
   );
   if (!contextResult.ok) return contextResult;
   const context = contextResult.context;
   const barber = context.barbers.find((item) => item.id === targetId);
   if (!barber) {
      return { ok: false, message: "Kapster tidak tersedia untuk memulai sesi." };
   }
   const sourceBarber =
      context.barbers.find((item) => item.id === booking.barber_id) ??
      (sourceBarberResult.data as SchedulingBarber);

   const running = hasRunningSession(context, targetId);
   const overlapping = findOverlappingBooking(
      context,
      targetId,
      startsAtMs,
      endsAtMs
   );
   const conflictBooking = running ?? overlapping;
   if (conflictBooking) {
      const conflict = makeStartConflict(
         context,
         barber,
         conflictBooking,
         running ? "running" : "booked",
         duration,
         nowMs,
         booking.customer_name,
         sourceBarber
      );
      return { ok: false, code: "conflict", conflict };
   }
   if (!startWithinHours(context.hours, targetId, today, startsAtMs)) {
      return { ok: false, message: "Waktu saat ini di luar jam kerja kapster." };
   }

   const scheduledAtMs = new Date(booking.starts_at).getTime();
   if (!confirmEarly && scheduledAtMs > nowMs) {
      return {
         ok: false,
         code: "early_confirmation",
         scheduleLabel: timeLabel(booking.starts_at),
         nowLabel: timeLabel(nowMs),
      };
   }

   const startsAt = new Date(startsAtMs).toISOString();
   const endsAt = new Date(endsAtMs).toISOString();
   const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update({
         barber_id: targetId,
         starts_at: startsAt,
         ends_at: endsAt,
         started_at: startsAt,
         status: "started",
      })
      .eq("id", bookingId)
      .eq("status", "confirmed")
      .select("id")
      .maybeSingle();
   if (updateError) {
      if (isNetworkError(updateError)) {
         return { ok: false, message: NETWORK_ERROR_MESSAGE };
      }
      if (updateError.code === "23P01") {
         const refreshed = await loadDayScheduling(
            supabase,
            today,
            nowMs - 24 * 60 * 60_000,
            dayStartMs + 24 * 60 * 60_000 + duration * 60_000,
            bookingId
         );
         if (refreshed.ok) {
            const latestContext = refreshed.context;
            const running = hasRunningSession(latestContext, targetId);
            const overlapping = findOverlappingBooking(
               latestContext,
               targetId,
               startsAtMs,
               endsAtMs
            );
            const conflictBooking = running ?? overlapping;
            if (conflictBooking) {
               return {
                  ok: false,
                  code: "conflict",
                  conflict: makeStartConflict(
                     latestContext,
                     barber,
                     conflictBooking,
                     running ? "running" : "booked",
                     duration,
                     Date.now(),
                     booking.customer_name,
                     sourceBarber
                  ),
               };
            }
         }
         return {
            ok: false,
            message: "Jadwal baru saja berubah. Periksa ketersediaan lalu coba lagi.",
         };
      }
      return { ok: false, message: "Gagal memulai sesi." };
   }
   if (!updated) {
      return { ok: false, message: "Booking berubah. Muat ulang lalu coba lagi." };
   }
   return { ok: true, barberChanged: targetId !== booking.barber_id };
}

async function requireAdmin(supabase: ServerSupabaseClient) {
   const auth = await requireAdminUser(supabase);
   if (auth.status === "unavailable") {
      return { ok: false as const, message: NETWORK_ERROR_MESSAGE };
   }
   if (auth.status === "unauthenticated") {
      return { ok: false as const, message: "Kamu harus login." };
   }
   return { ok: true as const };
}

export async function resolveBookingStart(
   bookingId: number,
   choice: "start_with_barber" | "schedule_any" | "schedule_same" | "finish_then_start",
   barberId?: number,
   sessionId?: number
) {
   const supabase = await createSupabaseServerClient();
   const auth = await requireAdmin(supabase);
   if (!auth.ok) return auth;
   if (
      choice !== "start_with_barber" &&
      choice !== "schedule_any" &&
      choice !== "schedule_same" &&
      choice !== "finish_then_start"
   ) {
      return { ok: false as const, message: "Pilihan mulai tidak valid." };
   }

   if (choice === "finish_then_start") {
      if (!Number.isInteger(sessionId) || !sessionId || sessionId < 1) {
         return { ok: false as const, message: "Sesi yang dipilih tidak valid." };
      }

      const { data: target, error: targetError } = await supabase
         .from("bookings")
         .select("status, barber_id, customer_name")
         .eq("id", bookingId)
         .maybeSingle();
      if (targetError || !target) {
         return {
            ok: false as const,
            message: targetError && isNetworkError(targetError)
               ? NETWORK_ERROR_MESSAGE
               : "Booking yang akan dimulai tidak ditemukan.",
         };
      }
      if (target.status !== "confirmed") {
         return { ok: false as const, message: "Booking ini bukan lagi berstatus dikonfirmasi." };
      }

      const { data: session, error: sessionError } = await supabase
         .from("bookings")
         .select("id, barber_id, customer_name, status, starts_at, ends_at, started_at, services(duration)")
         .eq("id", sessionId)
         .maybeSingle();
      if (sessionError || !session) {
         return {
            ok: false as const,
            message: sessionError && isNetworkError(sessionError)
               ? NETWORK_ERROR_MESSAGE
               : "Sesi berjalan tidak ditemukan.",
         };
      }
      if (session.status !== "started" || session.barber_id !== target.barber_id) {
         return {
            ok: false as const,
            message: "Sesi atau kapster sudah berubah. Muat ulang lalu coba lagi.",
         };
      }
      if (
         Date.now() <=
         new Date(estimatedSessionEnd(session as ActiveBooking)).getTime() +
            OVERDUE_GRACE_MINUTES * 60_000
      ) {
         return {
            ok: false as const,
            message: `${session.customer_name} masih dalam estimasi. Sesi belum diselesaikan.`,
         };
      }

      const finishResult = await updateBookingStatus(sessionId, "done");
      if (!finishResult.ok) {
         return {
            ok: false as const,
            message:
               ("message" in finishResult && finishResult.message) ||
               `${session.customer_name} belum dapat diselesaikan.`,
         };
      }

      const startResult = await runBookingStart(
         supabase,
         bookingId,
         true,
         target.barber_id
      );
      if (!startResult.ok) {
         if ("code" in startResult && startResult.code === "conflict") {
            return {
               ...startResult,
               conflict: {
                  ...startResult.conflict,
                  message: `${session.customer_name} sudah diselesaikan. ${startResult.conflict.message}`,
               },
            };
         }
         const reason =
            "message" in startResult
               ? startResult.message
               : "perlu konfirmasi tambahan";
         return {
            ok: false as const,
            message: `${session.customer_name} sudah diselesaikan, ${target.customer_name} belum dimulai: ${reason}`,
         };
      }
      revalidatePath("/admin");
      return { ok: true as const };
   }

   if (choice === "start_with_barber") {
      if (!Number.isInteger(barberId) || !barberId || barberId < 1) {
         return { ok: false as const, message: "Kapster pilihan tidak valid." };
      }
      const result = await runBookingStart(supabase, bookingId, true, barberId);
      if (!result.ok) return result;
      revalidatePath("/admin");
      return { ok: true as const };
   }

   const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("status, starts_at, barber_id, service_id")
      .eq("id", bookingId)
      .maybeSingle();
   if (bookingError) {
      return {
         ok: false as const,
         message: isNetworkError(bookingError)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa booking. Silakan coba lagi.",
      };
   }
   if (!booking || booking.status !== "confirmed") {
      return { ok: false as const, message: "Booking ini bukan lagi berstatus dikonfirmasi." };
   }

   const nowMs = Date.now();
   const today = jakartaDateKey(nowMs);
   if (jakartaDateKey(booking.starts_at) !== today) {
      return { ok: false as const, message: "Hanya booking hari ini yang bisa dijadwalkan ulang." };
   }
   const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("duration")
      .eq("id", booking.service_id)
      .single();
   if (serviceError || !service) {
      return {
         ok: false as const,
         message: serviceError && isNetworkError(serviceError)
            ? NETWORK_ERROR_MESSAGE
            : "Layanan tidak ditemukan.",
      };
   }

   const dayStartMs = jakartaMidnightMs(today);
   const contextResult = await loadDayScheduling(
      supabase,
      today,
      nowMs - 24 * 60 * 60_000,
      dayStartMs + 24 * 60 * 60_000 + service.duration * 60_000,
      bookingId
   );
   if (!contextResult.ok) return contextResult;
   const context = contextResult.context;
   let slot: BarberSlot | undefined;
   if (choice === "schedule_same") {
      const barber = context.barbers.find(
         (candidate) => candidate.id === booking.barber_id
      );
      if (barber) {
         slot = nearestFreeSlot(context, barber, service.duration, today, nowMs);
      }
   } else {
      slot = nearestFreeSlotAny(
         context,
         service.duration,
         today,
         nowMs
      );
   }
   if (!slot) {
      return {
         ok: false as const,
         message: "Belum ada jam kosong hari ini. Booking belum diubah.",
      };
   }

   const startsAtMs = new Date(slot.startsAt).getTime();
   const endsAt = new Date(startsAtMs + service.duration * 60_000).toISOString();
   const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update({
         barber_id: slot.barber.id,
         starts_at: slot.startsAt,
         ends_at: endsAt,
      })
      .eq("id", bookingId)
      .eq("status", "confirmed")
      .select("id")
      .maybeSingle();
   if (updateError) {
      return {
         ok: false as const,
         message: isNetworkError(updateError)
            ? NETWORK_ERROR_MESSAGE
            : updateError.code === "23P01"
              ? "Jadwal baru saja berubah. Pilih opsi lain."
              : "Gagal menjadwalkan ulang booking.",
      };
   }
   if (!updated) {
      return {
         ok: false as const,
         message: "Booking berubah. Muat ulang lalu coba lagi.",
      };
   }
   revalidatePath("/admin");
   return { ok: true as const };
}

export async function updateBookingStatus(
   bookingId: number,
   newStatus: string,
   confirmEarly = false
) {
   const supabase = await createSupabaseServerClient();
   const auth = await requireAdmin(supabase);
   if (!auth.ok) return auth;

   const parsed = statusSchema.safeParse(newStatus);
   if (!parsed.success) {
      return { ok: false as const, message: "Status tidak valid" };
   }

   if (parsed.data === "started") {
      const result = await runBookingStart(supabase, bookingId, confirmEarly);
      if (!result.ok) return result;
      const { data: booking } = await supabase
         .from("bookings")
         .select("customer_name, customer_phone, starts_at, services(name), barbers(name)")
         .eq("id", bookingId)
         .single();
      if (booking && !booking.customer_phone.startsWith("walkin-")) {
         const serviceName = Array.isArray(booking.services)
            ? booking.services[0]?.name ?? "Layanan"
            : (booking.services as { name?: string } | null)?.name ?? "Layanan";
         const barberName = Array.isArray(booking.barbers)
            ? booking.barbers[0]?.name ?? "Kapster"
            : (booking.barbers as { name?: string } | null)?.name ?? "Kapster";
         const startsAt = new Date(booking.starts_at);
         const date = jakartaDateKey(startsAt);
         try {
            await sendWhatsAppToCustomer(
               booking.customer_phone,
               buildCustomerStatusMessage({
                  storeName: STORE.name,
                  customerName: booking.customer_name,
                  barberName,
                  serviceName,
                  dateLabel: formatTanggalLabel(date),
                  timeLabel: timeLabel(startsAt),
                  status: "started",
               })
            );
         } catch {
            // Gagal mengirim WhatsApp tidak membatalkan perubahan status.
         }
      }
      revalidatePath("/admin");
      return { ok: true as const };
   }

   const { data: currentBooking, error: bookingCheckError } = await supabase
      .from("bookings")
      .select("status, starts_at")
      .eq("id", bookingId)
      .maybeSingle();
   if (bookingCheckError) {
      return {
         ok: false as const,
         message: isNetworkError(bookingCheckError)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa booking. Silakan coba lagi.",
      };
   }
   if (!currentBooking) {
      return { ok: false as const, message: "Booking tidak ditemukan." };
   }

   const nowMs = Date.now();
   if (
      parsed.data === "done" &&
      currentBooking.status === "confirmed" &&
      new Date(currentBooking.starts_at).getTime() > nowMs
   ) {
      return {
         ok: false as const,
         message: "Jadwal booking ini belum tiba, belum bisa diselesaikan.",
      };
   }

   const updates: {
      status: z.infer<typeof statusSchema>;
      cancelled_by?: "admin";
   } = { status: parsed.data };
   if (parsed.data === "cancelled") updates.cancelled_by = "admin";

   const { error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", bookingId);
   if (error) {
      return {
         ok: false as const,
         message: isNetworkError(error)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal update status.",
      };
   }

   const { data: booking } = await supabase
      .from("bookings")
      .select("customer_name, customer_phone, starts_at, services(name), barbers(name)")
      .eq("id", bookingId)
      .single();
   const isPastCancellation =
      parsed.data === "cancelled" &&
      new Date(currentBooking.starts_at).getTime() <= nowMs;

   if (
      booking &&
      !booking.customer_phone.startsWith("walkin-") &&
      !isPastCancellation
   ) {
      const serviceName = Array.isArray(booking.services)
         ? booking.services[0]?.name ?? "Layanan"
         : (booking.services as { name?: string } | null)?.name ?? "Layanan";
      const barberName = Array.isArray(booking.barbers)
         ? booking.barbers[0]?.name ?? "Kapster"
         : (booking.barbers as { name?: string } | null)?.name ?? "Kapster";
      const startsAt = new Date(booking.starts_at);
      const dateParts = new Intl.DateTimeFormat("en-GB", {
         timeZone: "Asia/Jakarta",
         year: "numeric",
         month: "2-digit",
         day: "2-digit",
      }).formatToParts(startsAt);
      const datePart = (type: string) =>
         dateParts.find((part) => part.type === type)?.value ?? "";
      const date = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
      const time = timeLabel(startsAt);

      try {
         const message =
            parsed.data === "confirmed"
               ? buildCustomerBookingMessage({
                    storeName: STORE.name,
                    customerName: booking.customer_name,
                    serviceName,
                    barberName,
                    date: formatTanggalPanjang(date),
                    timeLabel: time,
                 })
               : buildCustomerStatusMessage({
                    storeName: STORE.name,
                    customerName: booking.customer_name,
                    barberName,
                    serviceName,
                    dateLabel: formatTanggalLabel(date),
                    timeLabel: time,
                    status: parsed.data,
                 });
         await sendWhatsAppToCustomer(booking.customer_phone, message);
      } catch {
         // Gagal mengirim WhatsApp tidak membatalkan perubahan status.
      }
   }

   revalidatePath("/admin");
   return { ok: true as const };
}

const walkInSchema = z.object({
   customerName: z.string().trim().min(3),
   customerPhone: z.string().optional(),
   serviceId: z.number().int(),
   barberId: z.number().int().min(0),
   date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
   slotMinutes: z.number().int().min(0).max(1439),
   startNow: z.boolean(),
   sendWa: z.boolean(),
   customerNotes: z.string().trim().max(300).optional(),
});

const walkInResolutionSchema = z.discriminatedUnion("kind", [
   z.object({ kind: z.literal("start_with_barber"), barberId: z.number().int().positive() }),
   z.object({ kind: z.literal("schedule_any") }),
   z.object({ kind: z.literal("schedule_same") }),
]);

export async function createWalkInBooking(
   input: z.infer<typeof walkInSchema>,
   resolution?: z.infer<typeof walkInResolutionSchema>
) {
   const supabase = await createSupabaseServerClient();
   const auth = await requireAdmin(supabase);
   if (!auth.ok) return auth;

   const parsed = walkInSchema.safeParse(input);
   if (!parsed.success) {
      return { ok: false as const, message: "Data walk-in tidak valid." };
   }
   const parsedResolution =
      resolution === undefined
         ? undefined
         : walkInResolutionSchema.safeParse(resolution);
   if (parsedResolution && !parsedResolution.success) {
      return { ok: false as const, message: "Pilihan perubahan jadwal tidak valid." };
   }

   const data = parsed.data;
   const { date: todayStr } = getJakartaNow();
   const resolved = parsedResolution?.success ? parsedResolution.data : undefined;
   if (resolved?.kind === "start_with_barber" && !data.startNow) {
      return { ok: false as const, message: "Pilihan mulai sekarang tidak valid." };
   }
   const resolvingSchedule =
      resolved?.kind === "schedule_any" || resolved?.kind === "schedule_same";
   const isStartingNow = data.startNow && !resolvingSchedule;
   if (data.startNow && data.date !== todayStr) {
      return {
         ok: false as const,
         message: "Mulai sekarang hanya untuk walk-in hari ini.",
      };
   }
   const phoneInput = data.customerPhone?.trim() ?? "";
   if (phoneInput && !isValidIndonesianPhone(phoneInput)) {
      return { ok: false as const, message: "Nomor WA tidak valid." };
   }

   const customerPhone = phoneInput ? normalizePhone(phoneInput) : `walkin-${Date.now()}`;
   if (phoneInput) {
      const dayStartMs = jakartaMidnightMs(data.date);
      const dayEndIso = new Date(dayStartMs + 24 * 60 * 60_000).toISOString();
      const { count: sameDayBookingCount, error: sameDayBookingError } = await supabase
         .from("bookings")
         .select("id", { count: "exact", head: true })
         .eq("customer_phone", customerPhone)
         .in("status", [...activeBookingStatuses])
         .gte("starts_at", new Date(dayStartMs).toISOString())
         .lt("starts_at", dayEndIso);

      if (sameDayBookingError) {
         return {
            ok: false as const,
            message: isNetworkError(sameDayBookingError)
               ? NETWORK_ERROR_MESSAGE
               : "Gagal memeriksa booking pada tanggal ini. Silakan coba lagi.",
         };
      }
      if ((sameDayBookingCount ?? 0) > 0) {
         return {
            ok: false as const,
            message: "Nomor ini sudah memiliki booking aktif pada tanggal tersebut. Silakan pilih tanggal lain.",
         };
      }
   }

   const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("name, duration")
      .eq("id", data.serviceId)
      .single();
   if (serviceError || !service) {
      return {
         ok: false as const,
         message: serviceError && isNetworkError(serviceError)
            ? NETWORK_ERROR_MESSAGE
            : "Layanan tidak ditemukan.",
      };
   }

   const nowMs = Date.now();
   const effectiveDate = data.date;
   const dayStartMs = jakartaMidnightMs(effectiveDate);
   const contextResult = await loadDayScheduling(
      supabase,
      effectiveDate,
      (isStartingNow ? nowMs : dayStartMs) - 24 * 60 * 60_000,
      dayStartMs + 24 * 60 * 60_000 + service.duration * 60_000
   );
   if (!contextResult.ok) return contextResult;
   const context = contextResult.context;

   let barber: SchedulingBarber | undefined;
   let startsAtMs: number | undefined;
   let isStarted = isStartingNow;

   if (resolvingSchedule) {
      if (!data.startNow || data.barberId === 0 && resolved?.kind === "schedule_same") {
         return { ok: false as const, message: "Pilihan jadwal ulang tidak valid." };
      }
      if (resolved.kind === "schedule_same") {
         barber = context.barbers.find((item) => item.id === data.barberId);
         if (barber) {
            const slot = nearestFreeSlot(
               context,
               barber,
               service.duration,
               effectiveDate,
               nowMs
            );
            if (slot) startsAtMs = new Date(slot.startsAt).getTime();
         }
      } else {
         const slot = nearestFreeSlotAny(
            context,
            service.duration,
            effectiveDate,
            nowMs
         );
         if (slot) {
            barber = slot.barber;
            startsAtMs = new Date(slot.startsAt).getTime();
         }
      }
      if (!barber || startsAtMs === undefined) {
         return {
            ok: false as const,
            message: "Belum ada jam kosong hari ini. Booking belum disimpan.",
         };
      }
      isStarted = false;
   } else if (isStartingNow) {
      startsAtMs = nowMs;
      const endsAtMs = startsAtMs + service.duration * 60_000;
      if (resolved?.kind === "start_with_barber") {
         barber = context.barbers.find((item) => item.id === resolved.barberId);
      } else if (data.barberId === 0) {
         barber = pickBarber(
            findFreeBarbersNow(context, service.duration, startsAtMs),
            context
         );
      } else {
         barber = context.barbers.find((item) => item.id === data.barberId);
      }
      if (!barber) {
         return {
            ok: false as const,
            message: data.barberId === 0
               ? "Saat ini semua kapster sedang sibuk. Pilih jam antre atau coba lagi."
               : "Kapster tidak tersedia untuk memulai sesi.",
         };
      }

      const running = hasRunningSession(context, barber.id);
      const overlapping = findOverlappingBooking(
         context,
         barber.id,
         startsAtMs,
         endsAtMs
      );
      const conflictBooking = running ?? overlapping;
      if (conflictBooking) {
         if (data.barberId === 0 && resolved?.kind !== "start_with_barber") {
            return {
               ok: false as const,
               message: "Saat ini semua kapster sedang sibuk. Pilih jam antre atau coba lagi.",
            };
         }
         const conflict = makeStartConflict(
            context,
            barber,
            conflictBooking,
            running ? "running" : "booked",
            service.duration,
            nowMs,
            data.customerName,
            context.barbers.find((item) => item.id === data.barberId)
         );
         return { ok: false as const, code: "conflict", conflict };
      }
      if (!startWithinHours(context.hours, barber.id, effectiveDate, startsAtMs)) {
         return { ok: false as const, message: "Waktu saat ini di luar jam kerja kapster." };
      }
   } else {
      const selectedStartMs = dayStartMs + data.slotMinutes * 60_000;
      startsAtMs = effectiveDate === todayStr
         ? Math.max(selectedStartMs, Math.floor(nowMs / 60_000) * 60_000)
         : selectedStartMs;
      const endsAtMs = startsAtMs + service.duration * 60_000;
      const endMinute = (endsAtMs - dayStartMs) / 60_000;
      const hasFullWorkingHours = (barberId: number) =>
         context.hours.some(
            (hour) =>
               hour.barber_id === barberId &&
               data.slotMinutes >= timeToMinutes(hour.start_time) &&
               endMinute <= timeToMinutes(hour.end_time)
         );
      if (data.barberId === 0) {
         barber = pickBarber(
            findFreeBarbersAt(context, startsAtMs, service.duration, effectiveDate).filter(
               (candidate) => hasFullWorkingHours(candidate.id)
            ),
            context
         );
      } else {
         barber = context.barbers.find((item) => item.id === data.barberId);
      }
      if (!barber) {
         return {
            ok: false as const,
            message: data.barberId === 0
               ? "Tidak ada kapster kosong pada jam itu. Silakan pilih jam lain."
               : "Kapster tidak tersedia pada jam itu.",
         };
      }
      if (!hasFullWorkingHours(barber.id)) {
         return { ok: false as const, message: "Jam tersebut di luar jam kerja kapster." };
      }
      const running = hasRunningSession(context, barber.id);
      const overlapping = findOverlappingBooking(
         context,
         barber.id,
         startsAtMs,
         endsAtMs
      );
      if (running || overlapping) {
         return {
            ok: false as const,
            message: "Slot bentrok dengan booking lain. Pilih jam lain.",
         };
      }
   }

   const startsAt = new Date(startsAtMs).toISOString();
   const endsAt = new Date(startsAtMs + service.duration * 60_000).toISOString();
   const { error } = await supabase.from("bookings").insert({
      customer_name: data.customerName,
      customer_phone: customerPhone,
      customer_email: "",
      service_id: data.serviceId,
      barber_id: barber.id,
      customer_notes: data.customerNotes || null,
      starts_at: startsAt,
      ends_at: endsAt,
      status: isStarted ? "started" : "confirmed",
      ...(isStarted ? { started_at: startsAt } : {}),
   });

   if (error) {
      if (isNetworkError(error)) {
         return { ok: false as const, message: NETWORK_ERROR_MESSAGE };
      }
      if (error.code === "23P01") {
         if (isStarted && data.barberId !== 0 || resolved?.kind === "start_with_barber") {
            const refreshed = await loadDayScheduling(
               supabase,
               effectiveDate,
               nowMs - 24 * 60 * 60_000,
               dayStartMs + 24 * 60 * 60_000 + service.duration * 60_000
            );
            if (refreshed.ok) {
               const latestContext = refreshed.context;
               const running = hasRunningSession(latestContext, barber.id);
               const overlapping = findOverlappingBooking(
                  latestContext,
                  barber.id,
                  startsAtMs,
                  startsAtMs + service.duration * 60_000
               );
               const conflictBooking = running ?? overlapping;
               if (conflictBooking) {
                  return {
                     ok: false as const,
                     code: "conflict" as const,
                     conflict: makeStartConflict(
                        latestContext,
                        barber,
                        conflictBooking,
                        running ? "running" : "booked",
                        service.duration,
                        Date.now(),
                        data.customerName,
                        context.barbers.find((item) => item.id === data.barberId)
                     ),
                  };
               }
            }
         }
         return { ok: false as const, message: "Slot bentrok dengan booking lain. Pilih jam lain." };
      }
      if (error.code === "23505") {
         return { ok: false as const, message: "Nomor ini sudah punya booking aktif di hari yang sama." };
      }
      return { ok: false as const, message: "Gagal menyimpan walk-in." };
   }

   let message = `Walk-in untuk ${barber.name} berhasil dicatat.`;
   if (data.sendWa && phoneInput && !isStarted && !resolvingSchedule) {
      try {
         await sendWhatsAppToCustomer(
            customerPhone,
            buildCustomerBookingMessage({
               storeName: STORE.name,
               customerName: data.customerName,
               serviceName: service.name,
               barberName: barber.name,
               date: formatTanggalPanjang(data.date),
               timeLabel: timeLabel(startsAt),
            })
         );
         message = `Walk-in untuk ${barber.name} berhasil dicatat dan WA konfirmasi terkirim.`;
      } catch {
         message = `Walk-in untuk ${barber.name} tercatat, tetapi WA konfirmasi gagal dikirim.`;
      }
   }

   revalidatePath("/admin");
   return { ok: true as const, message };
}