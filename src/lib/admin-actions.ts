"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { z } from "zod";
import { sendWhatsAppToAdmin } from "@/lib/whatsapp";

const statusSchema = z.enum(["confirmed", "started", "done", "cancelled"]);

export async function updateBookingStatus(bookingId: number, newStatus: string) {
   const supabase = await createSupabaseServerClient();

   // Cek ganda di server: apakah yang memanggil benar-benar admin? 
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) {
      return { ok: false as const, message: "Kamu harus login." };
   }

   // Validasi status dengan Zod
   const parsed = statusSchema.safeParse(newStatus);
   if (!parsed.success) {
      return { ok: false as const, message: "Status tidak valid" };
   }

   // Update ke database
   const { error } = await supabase
      .from("bookings")
      .update({ status: parsed.data })
      .eq("id", bookingId);

     if (error) {
       return { 
          ok: false as const, 
          message: "Gagal update status." 
       };
     }

  try {
     const { data: booking } = await supabase
       .from("bookings")
       .select("customer_name, services(name)")
       .eq("id", bookingId)
       .single();

     if (booking) {
       const serviceName = Array.isArray(booking.services)
         ? booking.services[0]?.name ?? "Layanan"
         : (booking.services as {name?: string})?.name ?? "Layanan";

       await sendWhatsAppToAdmin(
         `🔄 STATUS BERUBAH\n\nBooking ${booking.customer_name} (${serviceName})\nStatus baru: ${parsed.data.toUpperCase()}`
       );
     }
  } catch {
     // Gagal mengirim WhatsApp tidak membatalkan perubahan status
  }

  revalidatePath("/admin");
  return { ok: true as const };
}