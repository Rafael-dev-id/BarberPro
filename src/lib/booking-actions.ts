"use server";

import { z } from "zod";
import { supabase } from "@/lib/supabase";
import {
   effectiveStart,
   getJakartaNow,
   MAX_BOOKING_DAYS,
   minutesToTime,
   timeToMinutes,
} from "@/lib/slots";
import { formatTanggalPanjang } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { STORE } from "@/lib/data";
import { bookingPath } from "@/lib/booking-link";
import {
   sendWhatsAppToAdmin,
   buildBookingMessage,
   sendWhatsAppToCustomer,
   buildCustomerBookingMessage,
} from "@/lib/whatsapp";

const bookingSchema = z.object({
   serviceId: z.number(),
   barberId: z.number().int().min(0),
   date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
   slotMinutes: z.number().int().min(0).max(23 * 60 + 59),
   customerName: z.string().trim().min(3),
   customerPhone: z.string().regex(/^\+628\d{8,11}$/),
   customerNotes: z.string().trim().max(300),
});

export type BookingInput = z.infer<typeof bookingSchema>;

function toIso(date: string, minutes: number): string {
   const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
   const mm = String(minutes % 60).padStart(2, "0");
   return `${date}T${hh}:${mm}:00+07:00`;
}

export async function minutesToIso(date: string, minutes: number): Promise<string> {
   return toIso(date, minutes);
}

export async function createBooking(input: BookingInput) {
   const parsed = bookingSchema.safeParse(input);

   if (!parsed.success) {
      return {
         ok: false as const,
         message: "Data tidak valid. Periksa kembali form kamu.",
      };
   }

   const data = parsed.data;

   const { date: todayStr, minutes: nowMinutes } = getJakartaNow();
   const maxDateObj = new Date(`${todayStr}T00:00:00Z`);
   maxDateObj.setUTCDate(maxDateObj.getUTCDate() + MAX_BOOKING_DAYS);
   const maxStr = maxDateObj.toISOString().slice(0, 10);

   if (data.date < todayStr || data.date > maxStr) {
      return {
         ok: false as const,
         message: "Tanggal di luar rentang pemesanan (hari ini sampai 14 hari ke depan).",
      };
   }

   const normalizedPhone = normalizePhone(data.customerPhone);
   const dayEndDate = new Date(`${data.date}T00:00:00Z`);
   dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1);
   const dayEndIso = `${dayEndDate.toISOString().slice(0, 10)}T00:00:00+07:00`;
   const { count: sameDayBookingCount, error: sameDayBookingError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_phone", normalizedPhone)
      .in("status", ["pending", "confirmed", "started"])
      .gte("starts_at", `${data.date}T00:00:00+07:00`)
      .lt("starts_at", dayEndIso);

   if (sameDayBookingError) {
      return {
         ok: false as const,
         message: "Gagal memeriksa booking pada tanggal ini. Silakan coba lagi.",
      };
   }
   if ((sameDayBookingCount ?? 0) > 0) {
      return {
         ok: false as const,
         message: "Nomor ini sudah memiliki booking aktif pada tanggal tersebut. Silakan pilih tanggal lain.",
      };
   }

   const { count: activeBookingCount, error: activeBookingError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_phone", normalizedPhone)
      .in("status", ["pending", "confirmed", "started"])
      .gt("ends_at", new Date().toISOString());

   if (activeBookingError) {
      return {
         ok: false as const,
         message: "Gagal memeriksa booking aktif nomor ini. Silakan coba lagi.",
      };
   }
   if ((activeBookingCount ?? 0) >= 3) {
      return {
         ok: false as const,
         message: "Nomor ini sudah memiliki 3 booking aktif. Silakan batalkan salah satu atau hubungi toko.",
      };
   }

   const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("name, duration, price")
      .eq("id", data.serviceId)
      .single();

   if (serviceError || !service) {
      return { ok: false as const, message: "Layanan tidak ditemukan." };
   }
   const effectiveSlotStart = effectiveStart(
      data.slotMinutes,
      nowMinutes,
      data.date === todayStr
   );
   const effectiveSlotEnd = effectiveSlotStart + service.duration;

   let barber: { id: number; name: string } | null = null;
   if (data.barberId === 0) {
      const [year, month, day] = data.date.split("-").map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const { data: activeBarbers, error: barbersError } = await supabase
         .from("barbers")
         .select("id, name")
         .eq("is_active", true);

      if (barbersError) {
         return {
            ok: false as const,
            message: "Gagal mencari kapster yang tersedia. Silakan coba lagi.",
         };
      }

      if (!activeBarbers?.length) {
         return {
            ok: false as const,
            message: "Tidak ada kapster tersedia di jam itu. Silakan pilih jam lain.",
         };
      }

      const activeBarberIds = activeBarbers.map((item) => item.id);
      const { data: workingHours, error: workingHoursError } = await supabase
         .from("working_hours")
         .select("barber_id, start_time, end_time")
         .in("barber_id", activeBarberIds)
         .eq("weekday", weekday);

      if (workingHoursError) {
         return {
            ok: false as const,
            message: "Gagal memeriksa jam kerja kapster. Silakan coba lagi.",
         };
      }

      const dayEndDate = new Date(`${data.date}T00:00:00Z`);
      dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1);
      const dayEndIso = `${dayEndDate.toISOString().slice(0, 10)}T00:00:00+07:00`;

      const availableBarbers = await Promise.all(
         activeBarbers.map(async (candidate) => {
            const candidateHours = (workingHours ?? []).filter(
               (hours) =>
                  hours.barber_id === candidate.id &&
                  data.slotMinutes >= timeToMinutes(hours.start_time) &&
                  effectiveSlotEnd <= timeToMinutes(hours.end_time)
            );
            if (candidateHours.length === 0) return null;

            const bookedRanges: {
               startMinutes: number;
               endMinutes: number;
            }[] = await getBookedSlots(candidate.id, data.date);
            if (
               bookedRanges.some(
                  (range) =>
                     effectiveSlotStart < range.endMinutes &&
                     effectiveSlotEnd > range.startMinutes
               )
            ) {
               return null;
            }

            const { count, error } = await supabase
               .from("bookings")
               .select("id", { count: "exact", head: true })
               .eq("barber_id", candidate.id)
               .neq("status", "cancelled")
               .gte("starts_at", `${data.date}T00:00:00+07:00`)
               .lt("starts_at", dayEndIso);

            if (error) return { candidate, count: null };
            return { candidate, count: count ?? 0 };
         })
      );

      if (availableBarbers.some((result) => result?.count === null)) {
         return {
            ok: false as const,
            message: "Gagal menghitung jadwal kapster. Silakan coba lagi.",
         };
      }

      const candidates = availableBarbers.filter(
         (result): result is { candidate: (typeof activeBarbers)[number]; count: number } =>
            result !== null
      );
      candidates.sort(
         (left, right) =>
            left.count - right.count || left.candidate.id - right.candidate.id
      );
      barber = candidates[0]?.candidate ?? null;
      if (!barber) {
         return {
            ok: false as const,
            message: "Tidak ada kapster tersedia di jam itu. Silakan pilih jam lain.",
         };
      }
   } else {
      const { data: selectedBarber, error: barberError } = await supabase
         .from("barbers")
         .select("id, name")
         .eq("id", data.barberId)
         .single();

      if (barberError || !selectedBarber) {
         return { ok: false as const, message: "Kapster tidak ditemukan." };
      }
      const [year, month, day] = data.date.split("-").map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const { data: workingHours, error: workingHoursError } = await supabase
         .from("working_hours")
         .select("start_time, end_time")
         .eq("barber_id", selectedBarber.id)
         .eq("weekday", weekday);

      if (workingHoursError) {
         return {
            ok: false as const,
            message: "Gagal memeriksa jam kerja kapster. Silakan coba lagi.",
         };
      }
      if (
         !workingHours.some(
            (hours) =>
               data.slotMinutes >= timeToMinutes(hours.start_time) &&
               effectiveSlotEnd <= timeToMinutes(hours.end_time)
         )
      ) {
         return {
            ok: false as const,
            message: "Jam tersebut di luar jam kerja kapster. Silakan pilih jam lain.",
         };
      }
      barber = selectedBarber;
   }

   if (!service || !barber) {
      return { ok: false as  const, message: "Layanan atau barber tidak ditemukan." };
   }

   const { data: publicToken, error } = await supabase.rpc(
      "insert_booking_returning_token",
      {
         p_service_id: data.serviceId,
         p_barber_id: barber.id,
         p_customer_name: data.customerName,
         p_customer_phone: normalizedPhone,
         p_customer_notes: data.customerNotes === "" ? null : data.customerNotes,
         p_starts_at: toIso(data.date, data.slotMinutes),
         p_ends_at: toIso(data.date, effectiveSlotEnd),
      }
   );

   if (error) {
      if (error.code === "23P01") { 
         // 23P01 → exclusion constraint dilanggar → slot bentrok
         return {
            ok: false as const,
            message: "Slot itu baru saja diambil pelanggan lain. Silakan pilih jam lain."
         };
      }

      if (error.code === "23505") {
         // 23505 → unique index dilanggar → nomor ini sudah punya booking aktif di hari yang sama
         return {
            ok: false as const,
            message: "Kamu sudah punya booking dengan nomor ini. Batalkan booking atau pakai nomor lain."
         }
      }

      if (error.code === "42501") { 
         // RLS menolak → tidak ada policy yang mengizinkan
         return {
            ok: false as const,
            message: "Ditolak oleh kebijakan keamanan database (RLS)"
         };
      }

      return { ok: false as const, message: "Gagal menyimpan booking. Coba lagi nanti" };
   }

   if (!publicToken) {
      return {
         ok: false as const,
         message: "Booking tersimpan, tetapi tautan pengelolaan belum tersedia. Hubungi barbershop.",
      };
   }

   const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
   let managementUrl: string | undefined;
   if (siteUrl) {
      try {
         managementUrl = new URL(
            bookingPath(String(publicToken)),
            `${siteUrl.replace(/\/+$/, "")}/`
         ).toString();
      } catch {
         managementUrl = undefined;
      }
   }

   const [adminWa, custWa] = await Promise.allSettled([
      sendWhatsAppToAdmin(
         buildBookingMessage({
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerNotes: data.customerNotes,
            serviceName: service.name,
            barberName: barber.name,
            date: formatTanggalPanjang(data.date),
            timeLabel: minutesToTime(data.slotMinutes),
         })
      ),
      sendWhatsAppToCustomer(
         data.customerPhone,
         buildCustomerBookingMessage({
            storeName: STORE.name,
            customerName: data.customerName,
            serviceName: service.name,
            barberName: barber.name,
            date: formatTanggalPanjang(data.date),
            timeLabel: minutesToTime(data.slotMinutes),
            managementUrl,
         })
      ),
   ]);

   const custOk = custWa.status === "fulfilled";
   if (adminWa.status === "rejected") {
      console.error("Notifikasi WhatsApp ke admin gagal.");
   }
   
   return {
      ok: true as const,
      message: "Booking berhasil.",
      warning: custOk
         ? undefined
         : "Konfirmasi WhatsApp belum terkirim. Simpan kode atau tautan booking kamu.",
      summary: {
         publicToken,
         code: publicToken.replace(/-/g, "").slice(0, 4).toUpperCase(),
         serviceName: service.name,
         barberName: barber.name,
         dateLabel: formatTanggalPanjang(data.date),
         timeLabel: minutesToTime(data.slotMinutes),
         price: service.price,
      },
   };
}

export async function getBookedSlots(barberId: number, date: string) {
   const idOk = z.number().safeParse(barberId).success;
   const dateOk = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(date).success;

   if (!idOk || !dateOk) return [];

   const dayStartMs = new Date(`${date}T00:00:00+07:00`).getTime();
   const startIso = new Date(dayStartMs - 24 * 60 * 60 * 1000).toISOString();
   const endIso = `${date}T23:59:59+07:00`;

   const { data, error } = await supabase.rpc("get_booked_slots", {
      p_barber_id: barberId,
      p_from: startIso,
      p_to: endIso,
   });

   if (error || !data) return [];

   return data.map((b: { starts_at: string; ends_at: string }) => ({
      startMinutes: isoToMinutes(b.starts_at, date),
      endMinutes: isoToMinutes(b.ends_at, date),
   }));
}

function isoToMinutes(iso: string, date: string): number {
   const dayStartMs = new Date(`${date}T00:00:00+07:00`).getTime();
   return (new Date(iso).getTime() - dayStartMs) / 60_000;
}