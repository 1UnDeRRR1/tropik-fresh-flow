UPDATE public.archive_promise_snapshots SET visible_archive_event_id = NULL
 WHERE snapshot_id IN ('aaaaaaaa-1111-4111-1111-000000000001','aaaaaaaa-2222-4222-2222-000000000002');
DELETE FROM public.branch_archive_results WHERE snapshot_id IN ('aaaaaaaa-1111-4111-1111-000000000001','aaaaaaaa-2222-4222-2222-000000000002');
DELETE FROM public.archive_promise_snapshots WHERE snapshot_id IN ('aaaaaaaa-1111-4111-1111-000000000001','aaaaaaaa-2222-4222-2222-000000000002');
DELETE FROM public.manager_offers WHERE id IN ('11111111-aaaa-4aaa-aaaa-000000000001','11111111-bbbb-4bbb-bbbb-000000000002');