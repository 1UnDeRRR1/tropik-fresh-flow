
DO $$ BEGIN
  CREATE TYPE public.manager_offer_target_mode AS ENUM ('all','selected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.manager_offers
  ADD COLUMN IF NOT EXISTS target_mode public.manager_offer_target_mode NOT NULL DEFAULT 'all';

CREATE TABLE IF NOT EXISTS public.manager_offer_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.manager_offers(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offer_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_mot_offer ON public.manager_offer_targets(offer_id);
CREATE INDEX IF NOT EXISTS idx_mot_branch ON public.manager_offer_targets(branch_id);

ALTER TABLE public.manager_offer_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mot owner all" ON public.manager_offer_targets;
CREATE POLICY "mot owner all" ON public.manager_offer_targets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.manager_offers o WHERE o.id = offer_id AND o.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.manager_offers o WHERE o.id = offer_id AND o.created_by = auth.uid()));

DROP POLICY IF EXISTS "mot admin all" ON public.manager_offer_targets;
CREATE POLICY "mot admin all" ON public.manager_offer_targets
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "mot staff read" ON public.manager_offer_targets;
CREATE POLICY "mot staff read" ON public.manager_offer_targets
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "mot branch read own" ON public.manager_offer_targets;
CREATE POLICY "mot branch read own" ON public.manager_offer_targets
  FOR SELECT TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()));

-- Tighten branch read on manager_offers to respect targeting
DROP POLICY IF EXISTS "manager_offers branch read" ON public.manager_offers;
CREATE POLICY "manager_offers branch read" ON public.manager_offers
  FOR SELECT TO authenticated
  USING (
    status IN ('active','in_work','confirmed','linked')
    AND public.user_branch_id(auth.uid()) IS NOT NULL
    AND (
      target_mode = 'all'
      OR EXISTS (
        SELECT 1 FROM public.manager_offer_targets t
        WHERE t.offer_id = manager_offers.id
          AND t.branch_id = public.user_branch_id(auth.uid())
      )
    )
  );

-- Tighten branch insert on responses similarly
DROP POLICY IF EXISTS "mor branch insert own" ON public.manager_offer_responses;
CREATE POLICY "mor branch insert own" ON public.manager_offer_responses
  FOR INSERT TO authenticated
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
