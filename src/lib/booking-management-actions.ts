"use server";

import { supabase } from "@/lib/supabase";
import {
  isNetworkError,
  NETWORK_ERROR_MESSAGE,
} from "@/lib/admin-auth";
import {
  UUID_PATTERN,
  type LastBookingSummary,
  type PublicBookingSummary,
} from "@/lib/public-booking";
import { scheduleCustomerCancellationNotice } from "@/lib/booking-notifications";

type CancelResult =
  | { code: "ok"; ok: true }
  | {
      code: "not_found" | "not_confirmed" | "too_late" | "error";
      ok: false;
      message: string;
    };

export type LastBookingLookup =
  | { kind: "valid"; booking: LastBookingSummary }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export async function getLastBookingSummary(
  token: string
): Promise<LastBookingLookup> {
  if (!UUID_PATTERN.test(token)) return { kind: "invalid" };

  try {
    const { data, error } = await supabase.rpc("get_booking_summary", {
      p_token: token,
    });
    if (error) {
      return { kind: "unavailable" };
    }
    if (!data) return { kind: "invalid" };

    const summary = data as PublicBookingSummary;
    if (
      summary.status !== "confirmed" ||
      new Date(summary.starts_at).getTime() <= Date.now()
    ) {
      return { kind: "invalid" };
    }

    return {
      kind: "valid",
      booking: {
        code: summary.code,
        service_name: summary.service_name,
        starts_at: summary.starts_at,
        status: "confirmed",
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
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
      scheduleCustomerCancellationNotice(token);
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
