-- Apply manually in Supabase SQL Editor after 003-booking-summary.sql.
-- Rollback: DROP FUNCTION IF EXISTS public.insert_booking_returning_token(bigint, bigint, text, text, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.insert_booking_returning_token(
  p_service_id bigint,
  p_barber_id bigint,
  p_customer_name text,
  p_customer_phone text,
  p_customer_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_token uuid;
BEGIN
  INSERT INTO public.bookings (
    service_id,
    barber_id,
    customer_name,
    customer_phone,
    customer_notes,
    starts_at,
    ends_at,
    status
  )
  VALUES (
    p_service_id,
    p_barber_id,
    p_customer_name,
    p_customer_phone,
    p_customer_notes,
    p_starts_at,
    p_ends_at,
    'confirmed'
  )
  RETURNING public_token INTO inserted_token;

  RETURN inserted_token;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_booking_returning_token(bigint, bigint, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_booking_returning_token(bigint, bigint, text, text, text, timestamptz, timestamptz) TO anon, authenticated;
