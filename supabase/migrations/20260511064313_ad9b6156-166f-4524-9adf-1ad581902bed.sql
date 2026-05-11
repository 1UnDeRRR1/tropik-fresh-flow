
DROP POLICY IF EXISTS "mor branch update own" ON public.manager_offer_responses;
CREATE POLICY "mor branch update own" ON public.manager_offer_responses
  FOR UPDATE TO authenticated
  USING (
    branch_id = public.user_branch_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.manager_offers o
      WHERE o.id = manager_offer_responses.offer_id
        AND o.status IN ('active','in_work','confirmed')
        AND (
          o.target_mode = 'all'
          OR EXISTS (
            SELECT 1 FROM public.manager_offer_targets t
            WHERE t.offer_id = o.id
              AND t.branch_id = public.user_branch_id(auth.uid())
          )
        )
    )
  )
  WITH CHECK (
    branch_id = public.user_branch_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.manager_offers o
      WHERE o.id = manager_offer_responses.offer_id
        AND o.status IN ('active','in_work','confirmed')
        AND (
          o.target_mode = 'all'
          OR EXISTS (
            SELECT 1 FROM public.manager_offer_targets t
            WHERE t.offer_id = o.id
              AND t.branch_id = public.user_branch_id(auth.uid())
          )
        )
    )
  );

DROP POLICY IF EXISTS "mor branch delete own" ON public.manager_offer_responses;
CREATE POLICY "mor branch delete own" ON public.manager_offer_responses
  FOR DELETE TO authenticated
  USING (
    branch_id = public.user_branch_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.manager_offers o
      WHERE o.id = manager_offer_responses.offer_id
        AND o.status = 'active'
        AND (
          o.target_mode = 'all'
          OR EXISTS (
            SELECT 1 FROM public.manager_offer_targets t
            WHERE t.offer_id = o.id
              AND t.branch_id = public.user_branch_id(auth.uid())
          )
        )
    )
  );
