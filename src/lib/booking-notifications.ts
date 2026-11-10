import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppToAdmin } from "@/lib/whatsapp";
import type { PublicBookingSummary } from "@/lib/public-booking";

function getCustomerCancellationNotice(summary: PublicBookingSummary): string {
  const startsAt = new Date(summary.starts_at);
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(startsAt);

  return [
    "🔔 PEMBATALAN BOOKING PELANGGAN",
    "",
    `Kode: ${summary.code}`,
    `Nama: ${summary.customer_name}`,
    `Layanan: ${summary.service_name}`,
    `Kapster: ${summary.barber_name}`,
    `Jadwal: ${date} · ${time} WIB`,
  ].join("\n");
}

export function scheduleCustomerCancellationNotice(token: string): void {
  after(async () => {
    try {
      const { data: summary, error } = await supabase.rpc(
        "get_booking_summary",
        { p_token: token }
      );
      if (error || !summary) return;
      await sendWhatsAppToAdmin(
        getCustomerCancellationNotice(summary as PublicBookingSummary)
      );
    } catch {
      // Notifikasi admin bersifat best-effort.
    }
  });
}
