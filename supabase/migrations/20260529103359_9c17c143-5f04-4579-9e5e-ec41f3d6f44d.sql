-- Gate 2: SELECT-only owner read policies for Calendar / Analytics / Statistics.
-- Additive only. No INSERT/UPDATE/DELETE/ALL. No WITH CHECK. No GRANT/REVOKE.
-- No ALTER TABLE. No DROP/ALTER POLICY. No changes to position_* tables.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipments' AND policyname='shipments owner read') THEN
    EXECUTE $p$CREATE POLICY "shipments owner read" ON public.shipments FOR SELECT TO authenticated USING (has_role(auth.uid(), 'owner'::app_role))$p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_items' AND policyname='shipment_items owner read') THEN
    EXECUTE $p$CREATE POLICY "shipment_items owner read" ON public.shipment_items FOR SELECT TO authenticated USING (has_role(auth.uid(), 'owner'::app_role))$p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='distributions' AND policyname='distributions owner read') THEN
    EXECUTE $p$CREATE POLICY "distributions owner read" ON public.distributions FOR SELECT TO authenticated USING (has_role(auth.uid(), 'owner'::app_role))$p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='distribution_items' AND policyname='distribution_items owner read') THEN
    EXECUTE $p$CREATE POLICY "distribution_items owner read" ON public.distribution_items FOR SELECT TO authenticated USING (has_role(auth.uid(), 'owner'::app_role))$p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='import_managers' AND policyname='import_managers owner read') THEN
    EXECUTE $p$CREATE POLICY "import_managers owner read" ON public.import_managers FOR SELECT TO authenticated USING (has_role(auth.uid(), 'owner'::app_role))$p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='suppliers owner read') THEN
    EXECUTE $p$CREATE POLICY "suppliers owner read" ON public.suppliers FOR SELECT TO authenticated USING (has_role(auth.uid(), 'owner'::app_role))$p$;
  END IF;
END $$;