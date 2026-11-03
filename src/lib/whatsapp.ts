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
}): string {
   return [
      p.storeName,
      "",
      `Halo ${p.customerName}, booking kamu sudah kami catat ✔`,
      `Layanan: ${p.serviceName}`,
      `Barber: ${p.barberName}`,
      `Tanggal: ${p.date}`,
      `Jam: ${p.timeLabel} WIB`,
      "Status: menunggu konfirmasi admin — kami kabari lagi di WhatsApp ini begitu jadwal dikonfirmasi.",
   ].join("\n");
}