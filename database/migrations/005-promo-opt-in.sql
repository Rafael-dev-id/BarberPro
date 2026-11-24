-- Apply manually in Supabase SQL Editor after 004-public-booking-token-return.sql.
-- Do not run from the app. The old 7-parameter function from 004 is NOT touched
-- (main/production may still call it); remove it in T10.
-- Rollback (order matters):
-- DROP FUNCTION IF EXISTS public.insert_booking_returning_token(bigint, bigint, text, text, text, timestamptz, timestamptz, boolean);
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS promo_opt_in_at;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS promo_opt_in;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS promo_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS promo_opt_in_at timestamptz;

-- New overload with 8 parameters. p_promo_opt_in has NO default on purpose,
-- so a 7-argument call can only match the old function (no ambiguity).
CREATE OR REPLACE FUNCTION public.insert_booking_returning_token(
  p_service_id bigint,
  p_barber_id bigint,
  p_customer_name text,
  p_customer_phone text,
  p_customer_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_promo_opt_in boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_token uuid;
  opted_in boolean := COALESCE(p_promo_opt_in, false);
BEGIN
  INSERT INTO public.bookings (
    service_id,
    barber_id,
    customer_name,
    customer_phone,
    customer_notes,
    starts_at,
    ends_at,
    status,
    promo_opt_in,
    promo_opt_in_at
  )
  VALUES (
    p_service_id,
    p_barber_id,
    p_customer_name,
    p_customer_phone,
    p_customer_notes,
    p_starts_at,
    p_ends_at,
    'confirmed',
    opted_in,
    CASE WHEN opted_in THEN now() ELSE NULL END
  )
  RETURNING public_token INTO inserted_token;

  RETURN inserted_token;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_booking_returning_token(bigint, bigint, text, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_booking_returning_token(bigint, bigint, text, text, text, timestamptz, timestamptz, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
