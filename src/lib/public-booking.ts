export type BookingCancelBlockReason = "not_confirmed" | "too_late" | null;

export interface PublicBookingSummary {
  code: string;
  customer_name: string;
  service_name: string;
  barber_name: string;
  starts_at: string;
  status: string;
  cancelled_by: "customer" | "admin" | null;
  can_cancel: boolean;
  cancel_block_reason: BookingCancelBlockReason;
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getPublicBookingStatus(
  status: string,
  cancelledBy: PublicBookingSummary["cancelled_by"]
): string {
  if (status === "cancelled") {
    if (cancelledBy === "customer") return "Dibatalkan pelanggan";
    if (cancelledBy === "admin") return "Dibatalkan admin";
    return "Dibatalkan";
  }

  const labels: Record<string, string> = {
    pending: "Menunggu konfirmasi",
    confirmed: "Dikonfirmasi",
    started: "Sedang dikerjakan",
    done: "Selesai",
  };
  return labels[status] ?? "Status belum diketahui";
}
