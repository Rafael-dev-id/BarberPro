export function formatRupiah(amount: number) {
   return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
   }).format(amount);
}

export function formatTanggalPanjang(dateStr: string): string {
   const date = new Date(`${dateStr}T00:00:00`);
   const weekday = new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
   }).format(date);
   const day = String(date.getDate()).padStart(2, "0");
   const month = String(date.getMonth() + 1).padStart(2, "0");
   const year = date.getFullYear();

   return `${weekday}, ${day}/${month}/${year}`;
}

export function formatTanggalLabel(dateStr: string): string {
   const today = new Date().toLocaleDateString("en-CA");
   const tomorrowDate = new Date();
   tomorrowDate.setDate(tomorrowDate.getDate() + 1);
   const tomorrow = tomorrowDate.toLocaleDateString("en-CA");
   const date = new Date(`${dateStr}T00:00:00`);
   const weekday = new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
   }).format(date);
   const day = String(date.getDate()).padStart(2, "0");
   const month = new Intl.DateTimeFormat("id-ID", {
      month: "short",
   })
      .format(date)
      .toLocaleLowerCase("id-ID");
   const label = `${weekday}, ${day} ${month}`;
   const prefix =
      dateStr === today ? "Hari ini · " : dateStr === tomorrow ? "Besok · " : "";

   return `${prefix}${label}`;
}