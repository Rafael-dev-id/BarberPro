"use server";

import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  isNetworkError,
  NETWORK_ERROR_MESSAGE,
} from "@/lib/admin-auth";
import { sendWhatsAppToAdmin } from "@/lib/whatsapp";
import type { PublicBookingSummary } from "@/lib/public-booking";
import { UUID_PATTERN } from "@/lib/public-booking";

type CancelResult =
  | { code: "ok"; ok: true }
  | {
      code: "not_found" | "not_confirmed" | "too_late" | "error";
      ok: false;
      message: string;
    };

function getAdminCancellationNotice(summary: PublicBookingSummary): string {
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

export async function cancelBookingByToken(token: string): Promise<CancelResult> {
  if (!UUID_PATTERN.test(token)) {
    return {
      ok: false,
      code: "not_found",
      message: "Booking tidak ditemukan.",
    };
  }

  try {
    const { data, error } = await supabase.rpc("cancel_booking_by_token", {
      p_token: token,
    });
    if (error) {
      return {
        ok: false,
        code: "error",
        message: isNetworkError(error)
          ? NETWORK_ERROR_MESSAGE
          : "Pembatalan belum berhasil. Silakan coba lagi.",
      };
    }

    if (data === "ok") {
      after(async () => {
        try {
          const { data: summary, error: summaryError } = await supabase.rpc(
            "get_booking_summary",
            { p_token: token }
          );
          if (summaryError || !summary) return;
          await sendWhatsAppToAdmin(
            getAdminCancellationNotice(summary as PublicBookingSummary)
          );
        } catch {
          // Notifikasi admin bersifat best-effort.
        }
      });
      return { ok: true, code: "ok" };
    }

    if (data === "not_found") {
      return {
        ok: false,
        code: "not_found",
        message: "Booking tidak ditemukan.",
      };
    }
    if (data === "not_confirmed") {
      return {
        ok: false,
        code: "not_confirmed",
        message: "Booking ini sudah tidak berstatus dikonfirmasi.",
      };
    }
    if (data === "too_late") {
      return {
        ok: false,
        code: "too_late",
        message:
          "Pembatalan tidak bisa dilakukan kurang dari 30 menit sebelum jadwal. Silakan hubungi barbershop.",
      };
    }
    return {
      ok: false,
      code: "error",
      message: "Pembatalan belum berhasil. Silakan coba lagi.",
    };
  } catch (error) {
    return {
      ok: false,
      code: "error",
      message: isNetworkError(error)
        ? NETWORK_ERROR_MESSAGE
        : "Pembatalan belum berhasil. Silakan coba lagi.",
    };
  }
}
