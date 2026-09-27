-- 0024_mint_talaria_claim.sql
-- Atomic claim mint: revoke-then-insert in one transaction with a per-user
-- advisory lock. Concurrent POST /api/talaria-claim was hitting the partial
-- unique index (one active claim per user) and returning 500.

CREATE OR REPLACE FUNCTION public.mint_talaria_claim(
  p_user_id uuid,
  p_plan_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan_slug text;
  _plan_title text;
BEGIN
  IF p_user_id IS NULL OR p_plan_id IS NULL OR p_token_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_args');
  END IF;

  -- Serialize concurrent mints for the same user.
  PERFORM pg_advisory_xact_lock(hashtextextended('talaria_claim:' || p_user_id::text, 0));

  SELECT slug, title INTO _plan_slug, _plan_title
  FROM public.plans
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan_not_found');
  END IF;

  UPDATE public.talaria_claims
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND revoked_at IS NULL;

  INSERT INTO public.talaria_claims (token_hash, user_id, plan_id, expires_at)
  VALUES (p_token_hash, p_user_id, p_plan_id, p_expires_at);

  RETURN jsonb_build_object(
    'ok', true,
    'plan_slug', _plan_slug,
    'plan_title', _plan_title
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mint_talaria_claim(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_talaria_claim(uuid, uuid, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.mint_talaria_claim IS
  'Atomic talaria claim mint: advisory-locked revoke-others + insert. Returns {ok, plan_slug, plan_title} or {ok:false, error}.';
