DO $$
DECLARE
  v_table regclass;
  v_tables regclass[] := ARRAY[
    'public.manager_offers'::regclass,
    'public.manager_offer_targets'::regclass,
    'public.manager_offer_allocation_parts'::regclass,
    'public.branch_requests'::regclass,
    'public.branch_request_items'::regclass,
    'public.distributions'::regclass,
    'public.distribution_items'::regclass
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table::name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s;', v_table::regclass);
    END IF;
  END LOOP;
END $$;