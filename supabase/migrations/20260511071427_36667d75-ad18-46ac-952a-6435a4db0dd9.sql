CREATE OR REPLACE FUNCTION public.can_access_manager_offer(_offer_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.manager_offers o
    WHERE o.id = _offer_id
      AND o.status IN ('active','in_work','confirmed','linked')
      AND (
        o.target_mode = 'all'
        OR EXISTS (
          SELECT 1
          FROM public.manager_offer_targets t
          WHERE t.offer_id = o.id
            AND t.branch_id = _branch_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.owns_manager_offer(_offer_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.manager_offers o
    WHERE o.id = _offer_id
      AND o.created_by = _user_id
  )
$$;

DROP POLICY IF EXISTS "manager_offers owner all" ON public.manager_offers;
CREATE POLICY "manager_offers owner all" ON public.manager_offers
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "manager_offers branch read" ON public.manager_offers;
CREATE POLICY "manager_offers branch read" ON public.manager_offers
  FOR SELECT TO authenticated
  USING (
    public.can_access_manager_offer(id, public.user_branch_id(auth.uid()))
  );

DROP POLICY IF EXISTS "mot owner all" ON public.manager_offer_targets;
CREATE POLICY "mot owner all" ON public.manager_offer_targets
  FOR ALL TO authenticated
  USING (public.owns_manager_offer(offer_id, auth.uid()))
  WITH CHECK (public.owns_manager_offer(offer_id, auth.uid()));

DROP POLICY IF EXISTS "mor owner all" ON public.manager_offer_responses;
CREATE POLICY "mor owner all" ON public.manager_offer_responses
  FOR ALL TO authenticated
  USING (public.owns_manager_offer(offer_id, auth.uid()))
  WITH CHECK (public.owns_manager_offer(offer_id, auth.uid()));

DROP POLICY IF EXISTS "mor branch insert own" ON public.manager_offer_responses;
CREATE POLICY "mor branch insert own" ON public.manager_offer_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    branch_id = public.user_branch_id(auth.uid())
    AND public.can_access_manager_offer(offer_id, public.user_branch_id(auth.uid()))
  );

DROP POLICY IF EXISTS "mor branch update own" ON public.manager_offer_responses;
CREATE POLICY "mor branch update own" ON public.manager_offer_responses
  FOR UPDATE TO authenticated
  USING (
    branch_id = public.user_branch_id(auth.uid())
    AND public.can_access_manager_offer(offer_id, public.user_branch_id(auth.uid()))
  )
  WITH CHECK (
    branch_id = public.user_branch_id(auth.uid())
    AND public.can_access_manager_offer(offer_id, public.user_branch_id(auth.uid()))
  );

DROP POLICY IF EXISTS "mor branch delete own" ON public.manager_offer_responses;
CREATE POLICY "mor branch delete own" ON public.manager_offer_responses
  FOR DELETE TO authenticated
  USING (
    branch_id = public.user_branch_id(auth.uid())
    AND public.can_access_manager_offer(offer_id, public.user_branch_id(auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.manager_offers o
      WHERE o.id = manager_offer_responses.offer_id
        AND o.status = 'active'
    )
  );