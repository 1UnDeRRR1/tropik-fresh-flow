
BEGIN;

DROP VIEW IF EXISTS public.branch_archive_events_branch;
DROP VIEW IF EXISTS public.branch_archive_events_manager;
DROP VIEW IF EXISTS public.branch_archive_events_admin;

DROP TRIGGER IF EXISTS trg_bae_block_mutation ON public.branch_archive_events;

DROP FUNCTION IF EXISTS public.bae_block_mutation();
DROP FUNCTION IF EXISTS public.bae_assert_pba_in_sync(uuid, uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.bae_record_delivered(uuid);
DROP FUNCTION IF EXISTS public.bae_record_cut_normal(uuid);
DROP FUNCTION IF EXISTS public.bae_record_cut_option_a(uuid);
DROP FUNCTION IF EXISTS public.bae_record_not_fulfilled(uuid);
DROP FUNCTION IF EXISTS public.bae_record_refusal_zero(uuid, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS public.recompute_pba_ordered_qty(uuid, uuid);

DROP TABLE IF EXISTS public.branch_archive_events;

DROP TYPE IF EXISTS public.branch_archive_event_type;
DROP TYPE IF EXISTS public.branch_archive_eta_source;
DROP TYPE IF EXISTS public.branch_archive_trigger_source;
DROP TYPE IF EXISTS public.branch_archive_confirmation_cost_source;
DROP TYPE IF EXISTS public.branch_archive_arrival_cost_source;
DROP TYPE IF EXISTS public.branch_archive_confirmation_cost_status;
DROP TYPE IF EXISTS public.branch_archive_arrival_cost_status;

COMMIT;
