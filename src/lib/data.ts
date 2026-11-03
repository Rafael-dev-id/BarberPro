// =====================================================
// STORE = kartu identitas toko.
// Saat memasang sistem untuk toko baru (trial maupun bayar),
// CUKUP file ini yang diubah teksnya untuk urusan merek.
// Database dan .env mengurus urusan data & kunci rahasia.
// =====================================================

export const STORE = {
   // Nama toko: muncul di tab browser, header, dan subjek email.
   name: "BarberPro",

   // Janji singkat yang menempel pada nama.
   tagline: "Barbershop Premium, Booking Tanpa Antre",

   // Baris kredit kecil di footer: jujur sekaligus iklan berjalan.
   credit: "Didukung BarberPro System oleh RR Devs",
   
   // Logo header dua warna: bagian polos + bagian emas.
   // Trial "Tamaro Barber Studio" misalnya: logoPlain "Tamaro", logoAccent "Barber Studio".
   logoPlain: "Barber",
   logoAccent: "Pro",
} as const;