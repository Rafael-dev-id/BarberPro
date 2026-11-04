"use server";

import { z } from "zod";
import { supabase } from "@/lib/supabase";
import {
   MAX_BOOKING_DAYS,
   minutesToTime,
   timeToMinutes,
} from "@/lib/slots";
import { formatTanggalPanjang } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { STORE } from "@/lib/data";
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

   const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta",
   });
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
      .select("name, duration")
      .eq("id", data.serviceId)
      .single();

   if (serviceError || !service) {
      return { ok: false as const, message: "Layanan tidak ditemukan." };
   }

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
                  data.slotMinutes + service.duration <=
                     timeToMinutes(hours.end_time)
            );
            if (candidateHours.length === 0) return null;

            const bookedRanges: {
               startMinutes: number;
               endMinutes: number;
            }[] = await getBookedSlots(candidate.id, data.date);
            const slotEnd = data.slotMinutes + service.duration;
            if (
               bookedRanges.some(
                  (range) =>
                     data.slotMinutes < range.endMinutes &&
                     slotEnd > range.startMinutes
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
      barber = selectedBarber;
   }

   if (!service || !barber) {
      return { ok: false as  const, message: "Layanan atau barber tidak ditemukan." };
   }

   const { error } = await supabase.from("bookings").insert({
      service_id: data.serviceId,
      barber_id: barber.id,
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      customer_notes: data.customerNotes === "" ? null : data.customerNotes,
      starts_at: toIso(data.date, data.slotMinutes),
      ends_at: toIso(data.date, data.slotMinutes + service.duration),
      status: "confirmed",
   });

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
         })
      ),
   ]);

   const waOk = adminWa.status === "fulfilled";
   const custOk = custWa.status === "fulfilled";
   const message = [
      "Booking berhasil.",
      waOk ? "Admin sudah diberitahu via whatsapp." : "Gagal mengirim notif ke admin.",
      custOk
         ? "Konfirmasi WhatsApp terkirim ke nomormu."
         : "WA konfirmasi ke nomormu gagal terkirim — bookingmu tetap tercatat.",
   ].join("\n");
   
   return { ok: true as const, message };
}

export async function getBookedSlots(barberId: number, date: string) {
   const idOk = z.number().safeParse(barberId).success;
   const dateOk = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(date).success;

   if (!idOk || !dateOk) return [];

   const startIso = `${date}T00:00:00+07:00`;
   const endIso = `${date}T23:59:59+07:00`;

   const { data, error } = await supabase.rpc("get_booked_slots", {
      p_barber_id: barberId,
      p_from: startIso,
      p_to: endIso,
   });

   if (error || !data) return [];

   return data.map((b: { starts_at: string; ends_at: string }) => ({
      startMinutes: isoToMinutes(b.starts_at),
      endMinutes: isoToMinutes(b.ends_at),
   }));
}

function isoToMinutes(iso: string): number {
   const d = new Date(iso);
   const hours = (d.getUTCHours() + 7) % 24;
   return hours * 60 + d.getUTCMinutes();
}