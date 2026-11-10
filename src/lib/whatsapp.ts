const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL ?? "https://api.fonnte.com/send";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;

export function isWhatsAppConfigured(): boolean {
   return Boolean(WHATSAPP_TOKEN && ADMIN_WHATSAPP_NUMBER);
}

interface BookingMessageParams {
   customerName: string;
   customerPhone: string;
   customerNotes: string;
   serviceName: string;
   barberName: string;
   date: string;
   timeLabel: string;
}

export function buildBookingMessage(p: BookingMessageParams) {
   return [
      "🔔 BOOKING BARU",
      "",
      `Nama: ${p.customerName}`,
      `Layanan: ${p.serviceName}`,
      `Barber: ${p.barberName}`,
      `Tanggal: ${p.date}`,
      `Jam: ${p.timeLabel} WIB`,
      `WA: ${p.customerPhone}`,
      p.customerNotes ? `Catatan: ${p.customerNotes}` : "",
   ]
      .filter(Boolean)
      .join("\n");
}

async function postToFonnte(target: string, message: string): Promise<void> {
   const response = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
         Authorization: WHATSAPP_TOKEN!,
         "Content-Type": "application/json",
      },
      body: JSON.stringify({
         target,
         message,
      }),
   });

   if (!response.ok) {
      throw new Error(`WhatsApp gateway error: ${response.status}`);
   }

   const json = await response.json().catch(() => null);

   if (json && json.status === false) {
      throw new Error(json.reason ?? "Gateway menolak pesan.");
   }
}

export async function sendWhatsAppToAdmin(message: string): Promise<void> {
   if (!isWhatsAppConfigured()) {
      throw new Error("Whatsapp belum dikonfigurasi.");
   }

   await postToFonnte(ADMIN_WHATSAPP_NUMBER!, message);
}

export async function sendWhatsAppToCustomer(
   customerPhone: string,
   message: string
): Promise<void> {
   if (!isWhatsAppConfigured()) {
      throw new Error("Whatsapp belum dikonfigurasi.");
   }

   await postToFonnte(customerPhone.replace(/^\+/, ""), message);
}

export function buildCustomerBookingMessage(p: {
   storeName: string;
   customerName: string;
   serviceName: string;
   barberName: string;
   date: string;
   timeLabel: string;
   managementUrl?: string;
}): string {
   return [
      p.storeName,
      "",
      `Halo ${p.customerName}, booking kamu sudah kami catat ✅`,
      `Layanan: ${p.serviceName}`,
      `Barber: ${p.barberName}`,
      `Tanggal: ${p.date}`,
      `Jam: ${p.timeLabel} WIB`,
      ...(p.managementUrl ? [`Kelola booking: ${p.managementUrl}`] : []),
      "Status: TERKONFIRMASI ✅ — datang 5–10 menit sebelum jam sesi.",
   ].join("\n");
}

export function buildCustomerStatusMessage(p: {
   storeName: string;
   customerName: string;
   barberName: string;
   serviceName: string;
   dateLabel: string;
   timeLabel: string;
   status: "started" | "done" | "cancelled";
}): string {
   if (p.status === "started") {
      return `Halo ${p.customerName}, giliran kamu sudah tiba — silakan datang ke kapster ${p.barberName} untuk mulai cukur.`;
   }
   if (p.status === "done") {
      return `Sesi kamu bersama ${p.barberName} sudah SELESAI ✅ Terima kasih sudah berkunjung ke ${p.storeName} — sampai jumpa di potongan berikutnya!`;
   }
   return `Booking kamu pada ${p.dateLabel} jam ${p.timeLabel} WIB DIBATALKAN. Maaf atas ketidaknyamanannya — kamu bisa booking ulang kapan saja.`;
}
