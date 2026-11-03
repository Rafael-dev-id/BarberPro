-- Cara pakai: jalankan sekali di Supabase SQL Editor setelah review T3.
-- Peringatan: jangan jalankan ulang. Jika bookings_status_check tidak ada, berhenti
-- dan kirim hasil query ini untuk diperiksa sebelum melanjutkan:
-- select conname from pg_constraint where conrelid = 'public.bookings'::regclass;

UPDATE public.bookings SET status = 'confirmed' WHERE status = 'pending';
ALTER TABLE public.bookings ALTER COLUMN status SET DEFAULT 'confirmed';
ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('pending','confirmed','started','done','cancelled'));
ALTER TABLE public.bookings DROP CONSTRAINT bookings_no_overlap;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (barber_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN ('pending','confirmed','started'));
CREATE OR REPLACE FUNCTION public.get_booked_slots(p_barber_id int8, p_from timestamptz, p_to timestamptz) RETURNS TABLE (starts_at timestamptz, ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ select starts_at, ends_at from public.bookings where barber_id = p_barber_id and status in ('pending','confirmed','started') and starts_at >= p_from and starts_at <= p_to; $$;
