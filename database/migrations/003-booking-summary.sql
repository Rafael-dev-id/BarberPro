-- Apply manually in Supabase SQL Editor after review; do not run from the app.
-- Rollback (destructive to data in the added columns):
-- DROP FUNCTION IF EXISTS public.get_booking_summary(uuid);
-- DROP FUNCTION IF EXISTS public.cancel_booking_by_token(uuid);
-- DROP INDEX IF EXISTS public.bookings_public_token_uidx;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS public_token;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS cancelled_by;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS started_at;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS public_token uuid;

ALTER TABLE public.bookings
  ALTER COLUMN public_token SET DEFAULT gen_random_uuid();

UPDATE public.bookings
SET public_token = gen_random_uuid()
WHERE public_token IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_public_token_uidx
  ON public.bookings (public_token);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND conname = 'bookings_cancelled_by_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_cancelled_by_check
      CHECK (cancelled_by IN ('customer', 'admin'));
  END IF;
END;
$$;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

CREATE OR REPLACE FUNCTION public.get_booking_summary(p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'code', upper(left(replace(b.public_token::text, '-', ''), 4)),
    'customer_name', b.customer_name,
    'service_name', s.name,
    'barber_name', br.name,
    'starts_at', b.starts_at,
    'status', b.status,
    'cancelled_by', b.cancelled_by,
    'can_cancel',
      b.status = 'confirmed'
      AND b.starts_at - now() >= interval '30 minutes',
    'cancel_block_reason',
      CASE
        WHEN b.status <> 'confirmed' THEN 'not_confirmed'
        WHEN b.starts_at - now() < interval '30 minutes' THEN 'too_late'
        ELSE NULL
      END
  )
  FROM public.bookings AS b
  JOIN public.services AS s ON s.id = b.service_id
  JOIN public.barbers AS br ON br.id = b.barber_id
  WHERE b.public_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_booking_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_summary(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_booking_by_token(p_token uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows integer;
  booking_status text;
BEGIN
  UPDATE public.bookings
  SET status = 'cancelled',
      cancelled_by = 'customer'
  WHERE public_token = p_token
    AND status = 'confirmed'
    AND starts_at - now() >= interval '30 minutes';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 1 THEN
    RETURN 'ok';
  END IF;

  SELECT status
  INTO booking_status
  FROM public.bookings
  WHERE public_token = p_token;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF booking_status <> 'confirmed' THEN
    RETURN 'not_confirmed';
  END IF;
  RETURN 'too_late';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_token(uuid) TO anon, authenticated;
