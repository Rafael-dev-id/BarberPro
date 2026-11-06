import { CalendarCheck, Wallet, Hourglass, Crown } from "lucide-react";
import StatCard from "@/components/StatCard";
import { type BookingRow } from "@/lib/types";
import { formatRupiah } from "@/lib/format";
import { jakartaDateKey } from "@/lib/booking-state";

export default function AdminStats({ bookings }: { bookings: BookingRow[] }) {
   const all = bookings ?? [];
   
   // ---------- STATISTIK ----------

   // "Hari ini" menurut zona waktu SALON (WIB), bukan zona waktu server.
   const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta",
   });
   const todayBookings = all.filter(
      (b) => b.status !== "cancelled" && jakartaDateKey(b.starts_at) === today
   );

   const doneToday = todayBookings.filter((b) => b.status === "done");

   const revenueToday = doneToday.reduce(
      (total, b) => total + (b.services?.price ?? 0),
      0
   );

   const startedToday = all.filter(
      (b) => b.status === "started" && jakartaDateKey(b.starts_at) === today
   );
   const staleStartedCount = all.filter(
      (b) => b.status === "started" && jakartaDateKey(b.starts_at) < today
   ).length;

   // Barber tersibuk (semua waktu, booking tidak batal)
   const counts = new Map<string, number>();
   for (const b of all) {
      if (b.status === "cancelled") continue;
      const name = b.barbers?.name ?? "Tanpa Nama";
      counts.set(name, (counts.get(name) ?? 0) + 1);
   }

   let busiest = "-";
   let busiestCount = 0;
   for (const [name, count] of counts) {
      if (count > busiestCount) {
         busiest = name;
         busiestCount = count;
      }
   }
   
   return (
      <>
         <section className="card p-5 sm:p-6">
         <h1 className="font-display text-xl font-semibold">Ringkasan hari ini</h1>
         <p className="mt-1 text-sm text-ink/70">
           Ringkasan booking, pendapatan, dan aktivitas kapster.
         </p>
         <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
           <StatCard
             label="Booking Hari Ini"
             value={String(todayBookings.length)}
             icon={<CalendarCheck size={18} />}
           />
           <StatCard
             label="Pendapatan Hari Ini"
             value={formatRupiah(revenueToday)}
             sub={`${doneToday.length} sesi selesai`}
             icon={<Wallet size={18} />}
           />
           <StatCard
             label="Sedang Dikerjakan"
             value={String(startedToday.length)}
             sub={
               staleStartedCount > 0
                  ? `${staleStartedCount} belum ditutup`
                  : undefined
             }
             icon={<Hourglass size={18} />}
           />
           <StatCard
             label="Kapster Tersibuk"
             value={busiest}
             sub={`${busiestCount} booking`}
             icon={<Crown size={18} />}
           />
         </div>
         </section>
      </>
   );
}