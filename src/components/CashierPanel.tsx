"use client";

import { getJakartaNow } from "@/lib/slots";
import { formatRupiah } from "@/lib/format";
import { type Barber, type BookingRow } from "@/lib/types";

interface CashierPanelProps {
  bookings: BookingRow[];
  barbers: Barber[];
  busyId: number | null;
  onFinish: (bookingId: number) => void;
}

const jakartaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
});
const jakartaTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default function CashierPanel({
  bookings,
  barbers,
  busyId,
  onFinish,
}: CashierPanelProps) {
  const today = getJakartaNow().date;
  const todayBookings = bookings.filter(
    (booking) => jakartaDateFormatter.format(new Date(booking.starts_at)) === today
  );

  return (
    <section className="mt-6">
      <h2 className="font-display text-xl font-semibold">Sedang dikerjakan</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {barbers.filter((barber) => barber.is_active).map((barber) => {
          const startedBookings = todayBookings.filter(
            (booking) =>
              booking.status === "started" &&
              booking.barbers?.name === barber.name
          );

          return (
            <article
              key={barber.id}
              className="rounded-2xl border border-cream/10 bg-ink/60 p-4"
            >
              <h3 className="font-semibold text-gold-300">{barber.name}</h3>
              {startedBookings.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {startedBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="rounded-xl border border-cream/10 bg-ink p-3"
                    >
                      <p className="font-medium text-cream">{booking.customer_name}</p>
                      <p className="mt-1 text-sm text-cream/70">
                        {booking.services?.name ?? "Layanan"} ·{" "}
                        {booking.customer_phone.startsWith("walkin-")
                          ? "Tanpa nomor"
                          : booking.customer_phone}
                      </p>
                      <p className="mt-1 text-xs text-cream/60">
                        {jakartaTimeFormatter.format(new Date(booking.starts_at))}-
                        {jakartaTimeFormatter.format(new Date(booking.ends_at))}
                      </p>
                      {booking.customer_notes && (
                        <p className="mt-2 text-sm text-cream/70">
                          Catatan: {booking.customer_notes}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => onFinish(booking.id)}
                        className="mt-3 w-full rounded-xl bg-gold px-3 py-2 text-sm font-bold text-ink transition hover:bg-gold-soft disabled:opacity-50"
                      >
                        Selesai · {formatRupiah(booking.services?.price ?? 0)}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-cream/50">Kosong</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
