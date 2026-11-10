"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { z } from "zod";
import {
   sendWhatsAppToCustomer,
   buildCustomerBookingMessage,
   buildCustomerStatusMessage,
} from "@/lib/whatsapp";
import { getBookedSlots, minutesToIso } from "@/lib/booking-actions";
import { isValidIndonesianPhone, normalizePhone } from "@/lib/phone";
import { formatTanggalLabel, formatTanggalPanjang } from "@/lib/format";
import { jakartaDateKey } from "@/lib/booking-state";
import {
   effectiveStart,
   getJakartaNow,
   minutesToTime,
   timeToMinutes,
} from "@/lib/slots";
import { STORE } from "@/lib/data";
import {
   isNetworkError,
   NETWORK_ERROR_MESSAGE,
   requireAdminUser,
} from "@/lib/admin-auth";

const statusSchema = z.enum(["confirmed", "started", "done", "cancelled"]);

export async function updateBookingStatus(bookingId: number, newStatus: string) {
   const supabase = await createSupabaseServerClient();

   // Cek ganda di server: apakah yang memanggil benar-benar admin?
   const auth = await requireAdminUser(supabase);
   if (auth.status === "unavailable") {
      return { ok: false as const, message: NETWORK_ERROR_MESSAGE };
   }
   if (auth.status === "unauthenticated") {
      return { ok: false as const, message: "Kamu harus login." };
   }

   // Validasi status dengan Zod
   const parsed = statusSchema.safeParse(newStatus);
   if (!parsed.success) {
      return { ok: false as const, message: "Status tidak valid" };
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
      parsed.data === "started" &&
      jakartaDateKey(currentBooking.starts_at) !== getJakartaNow().date
   ) {
      return { ok: false as const, message: "Hanya booking hari ini yang bisa dimulai." };
   }
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

   // Update ke database
   const updates: {
      status: z.infer<typeof statusSchema>;
      started_at?: string;
      cancelled_by?: "admin";
   } = { status: parsed.data };
   if (parsed.data === "started") updates.started_at = new Date().toISOString();
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
             : "Gagal update status."
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
     const timeLabel = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
     }).format(startsAt);

     try {
        const message =
           parsed.data === "confirmed"
              ? buildCustomerBookingMessage({
                   storeName: STORE.name,
                   customerName: booking.customer_name,
                   serviceName,
                   barberName,
                   date: formatTanggalPanjang(date),
                   timeLabel,
                })
              : buildCustomerStatusMessage({
                   storeName: STORE.name,
                   customerName: booking.customer_name,
                   barberName,
                   serviceName,
                   dateLabel: formatTanggalLabel(date),
                   timeLabel,
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
   barberId: z.number().int(),
   date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
   slotMinutes: z.number().int().min(0).max(1439),
   startNow: z.boolean(),
   sendWa: z.boolean(),
   customerNotes: z.string().trim().max(300).optional(),
});

export async function createWalkInBooking(input: z.infer<typeof walkInSchema>) {
   const supabase = await createSupabaseServerClient();
   const auth = await requireAdminUser(supabase);
   if (auth.status === "unavailable") {
      return { ok: false as const, message: NETWORK_ERROR_MESSAGE };
   }
   if (auth.status === "unauthenticated") {
      return { ok: false as const, message: "Kamu harus login." };
   }

   const parsed = walkInSchema.safeParse(input);
   if (!parsed.success) {
      return { ok: false as const, message: "Data walk-in tidak valid." };
   }

   const data = parsed.data;
   const { date: todayStr, minutes: nowMinutes } = getJakartaNow();
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

   const customerPhone = phoneInput
      ? normalizePhone(phoneInput)
      : `walkin-${Date.now()}`;
   if (phoneInput) {
      const dayEndDate = new Date(`${data.date}T00:00:00Z`);
      dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1);
      const dayEndIso = `${dayEndDate.toISOString().slice(0, 10)}T00:00:00+07:00`;
      const { count: sameDayBookingCount, error: sameDayBookingError } = await supabase
         .from("bookings")
         .select("id", { count: "exact", head: true })
         .eq("customer_phone", customerPhone)
         .in("status", ["pending", "confirmed", "started"])
         .gte("starts_at", `${data.date}T00:00:00+07:00`)
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

   const [year, month, day] = data.date.split("-").map(Number);
   const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

   const [serviceResult, barberResult, workingHoursResult] = await Promise.all([
      supabase
         .from("services")
         .select("name, duration")
         .eq("id", data.serviceId)
         .single(),
      supabase
         .from("barbers")
         .select("name")
         .eq("id", data.barberId)
         .single(),
      supabase
         .from("working_hours")
         .select("start_time, end_time")
         .eq("barber_id", data.barberId)
         .eq("weekday", weekday),
   ]);

   if (serviceResult.error || barberResult.error) {
      const error = serviceResult.error ?? barberResult.error;
      return {
         ok: false as const,
         message: error && isNetworkError(error)
            ? NETWORK_ERROR_MESSAGE
            : "Layanan atau kapster tidak ditemukan.",
      };
   }
   if (workingHoursResult.error) {
      return {
         ok: false as const,
         message: isNetworkError(workingHoursResult.error)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa jam kerja kapster.",
      };
   }

   const service = serviceResult.data;
   const barber = barberResult.data;
   const effectiveSlotStart = effectiveStart(
      data.slotMinutes,
      nowMinutes,
      data.date === todayStr
   );
   const slotEnd = effectiveSlotStart + service.duration;
   const isWithinWorkingHours = workingHoursResult.data.some(
      (hours) =>
         data.slotMinutes >= timeToMinutes(hours.start_time) &&
         slotEnd <= timeToMinutes(hours.end_time)
   );
   if (!isWithinWorkingHours) {
      return { ok: false as const, message: "Jam tersebut di luar jam kerja kapster." };
   }

   let bookedRanges: { startMinutes: number; endMinutes: number }[];
   try {
      bookedRanges = await getBookedSlots(data.barberId, data.date);
   } catch (error) {
      return {
         ok: false as const,
         message: isNetworkError(error)
            ? NETWORK_ERROR_MESSAGE
            : "Gagal memeriksa ketersediaan jam.",
      };
   }
   // Match the stored range: starts_at is the slot; ends_at is the real-time end.
   if (
      bookedRanges.some(
         (range) =>
            data.slotMinutes < range.endMinutes &&
            slotEnd > range.startMinutes
      )
   ) {
      return { ok: false as const, message: "Slot bentrok dengan booking lain. Pilih jam lain." };
   }

   const startsAt = await minutesToIso(data.date, data.slotMinutes);
   const endsAt = await minutesToIso(data.date, slotEnd);
   const { error } = await supabase.from("bookings").insert({
      customer_name: data.customerName,
      customer_phone: customerPhone,
      customer_email: "",
      service_id: data.serviceId,
      barber_id: data.barberId,
      customer_notes: data.customerNotes || null,
      starts_at: startsAt,
      ends_at: endsAt,
      status: data.startNow ? "started" : "confirmed",
   });

   if (error) {
      if (isNetworkError(error)) {
         return { ok: false as const, message: NETWORK_ERROR_MESSAGE };
      }
      if (error.code === "23P01") {
         return { ok: false as const, message: "Slot bentrok dengan booking lain. Pilih jam lain." };
      }
      if (error.code === "23505") {
         return { ok: false as const, message: "Nomor ini sudah punya booking aktif di hari yang sama." };
      }
      return { ok: false as const, message: "Gagal menyimpan walk-in." };
   }

   let message = "Walk-in berhasil dicatat.";
   if (data.sendWa && phoneInput && !data.startNow) {
      try {
         await sendWhatsAppToCustomer(
            customerPhone,
            buildCustomerBookingMessage({
               storeName: STORE.name,
               customerName: data.customerName,
               serviceName: service.name,
               barberName: barber.name,
               date: formatTanggalPanjang(data.date),
               timeLabel: minutesToTime(data.slotMinutes),
            })
         );
         message = "Walk-in berhasil dicatat dan WA konfirmasi terkirim.";
      } catch {
         message = "Walk-in tercatat, tetapi WA konfirmasi gagal dikirim.";
      }
   }

   revalidatePath("/admin");
   return { ok: true as const, message };
}