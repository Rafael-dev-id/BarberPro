import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import AdminBookingsTable from "@/components/AdminBookingsTable";
import { type Barber, type BookingRow, type Service, type WorkingHour } from "@/lib/types";

export default async function AdminPage() {
   const supabase = await createSupabaseServerClient();
   const { data: { user } } = await supabase.auth.getUser();

   if (!user) {
      redirect("/admin/login");
   }

   // Relational Query: Join tabel bookings, services, dan barbers 
   const { data: bookings, error } = await supabase
      .from("bookings")
      .select("*, services(name, price, duration), barbers(name)")
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true });

   if (error) {
      return <p className="text-red-500">
            Gagal memuat booking: {error.message}
         </p>;
   }

   const [servicesResult, barbersResult, workingHoursResult] = await Promise.all([
      supabase.from("services").select("*").eq("is_active", true),
      supabase.from("barbers").select("*").eq("is_active", true),
      supabase.from("working_hours").select("*"),
   ]);

   if (servicesResult.error || barbersResult.error || workingHoursResult.error) {
      return (
         <p className="text-red-500">
            Gagal memuat data layanan, kapster, atau jam kerja.
         </p>
      );
   }

   const all = bookings ?? [];

   // ---------- RENDER ----------
   
  return (
    <section>
      <AdminBookingsTable
         initialBookings={all as BookingRow[]}
         services={(servicesResult.data ?? []) as Service[]}
         barbers={(barbersResult.data ?? []) as Barber[]}
         workingHours={(workingHoursResult.data ?? []) as WorkingHour[]}
      />
    </section>
  );
}