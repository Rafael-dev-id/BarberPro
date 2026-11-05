"use client";

import { useEffect, useState } from "react";
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
  const [nowMs, setNowMs] = useState<number | null>(null);
  const todayBookings = bookings.filter(
    (booking) => jakartaDateFormatter.format(new Date(booking.starts_at)) === today
  );

  useEffect(() => {
    const clockTimer = setTimeout(() => setNowMs(Date.now()), 0);
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      clearTimeout(clockTimer);
      clearInterval(interval);
    };
  }, []);

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
          const nextBooking = todayBookings
            .filter(
              (booking) =>
                booking.status === "confirmed" &&
                booking.barbers?.name === barber.name &&
                nowMs !== null &&
                new Date(booking.starts_at).getTime() >= nowMs
            )
            .sort(
              (left, right) =>
                new Date(left.starts_at).getTime() -
                new Date(right.starts_at).getTime()
            )[0];

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
              <p className="mt-3 border-t border-cream/10 pt-3 text-sm text-cream/70">
                {nextBooking
                  ? `Berikutnya: ${nextBooking.customer_name} · ${jakartaTimeFormatter.format(new Date(nextBooking.starts_at))}`
                  : "Tidak ada antrean"}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function CashierRevenueTable({
  bookings,
  barbers,
}: Pick<CashierPanelProps, "bookings" | "barbers">) {
  const today = getJakartaNow().date;
  const todayBookings = bookings.filter(
    (booking) => jakartaDateFormatter.format(new Date(booking.starts_at)) === today
  );
  const doneToday = todayBookings.filter((booking) => booking.status === "done");
  const activeBarberNames = barbers
    .filter((barber) => barber.is_active)
    .map((barber) => barber.name);
  const otherBarberNames = Array.from(
    new Set(doneToday.map((booking) => booking.barbers?.name ?? "Tanpa kapster"))
  ).filter((name) => !activeBarberNames.includes(name));
  const revenueRows = Array.from(new Set([...activeBarberNames, ...otherBarberNames]));

  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-semibold">
        Selesai hari ini per kapster
      </h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-cream/10">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="bg-ink/70 text-cream/60">
            <tr>
              <th className="px-4 py-2 font-medium">Kapster</th>
              <th className="px-4 py-2 text-right font-medium">Sesi</th>
              <th className="px-4 py-2 text-right font-medium">Rupiah</th>
            </tr>
          </thead>
          <tbody>
            {revenueRows.map((name) => {
              const barberDone = doneToday.filter(
                (booking) => (booking.barbers?.name ?? "Tanpa kapster") === name
              );
              const revenue = barberDone.reduce(
                (total, booking) => total + (booking.services?.price ?? 0),
                0
              );
              return (
                <tr key={name} className="border-t border-cream/10">
                  <td className="px-4 py-2 text-cream">{name}</td>
                  <td className="px-4 py-2 text-right text-cream/70">
                    {barberDone.length}
                  </td>
                  <td className="px-4 py-2 text-right text-cream/70">
                    {formatRupiah(revenue)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-gold/40 bg-ink/70 font-bold">
              <td className="px-4 py-2 text-gold-300">Total</td>
              <td className="px-4 py-2 text-right text-cream">{doneToday.length}</td>
              <td className="px-4 py-2 text-right text-cream">
                {formatRupiah(
                  doneToday.reduce(
                    (total, booking) => total + (booking.services?.price ?? 0),
                    0
                  )
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
