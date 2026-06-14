
-- Tropik Archive — data-only backfill for ETA <= 2026-06-15 cleanup snapshots.
-- Scope is locked to snapshots created by migration 20260614214447 via the
-- exact notes marker AND source='shipment_link' AND status/resolution match.
-- Reference dictionaries are read-only; no schema/view/policy/trigger changes.

WITH scope AS (
  SELECT s.snapshot_id, s.position_id, s.source_shipment_id
    FROM public.archive_promise_snapshots s
   WHERE s.notes        = 'Test-data cleanup: ETA <= 2026-06-15 -> Delivered archive'
     AND s.source       = 'shipment_link'
     AND s.status       = 'resolved'
     AND s.resolution   = 'delivered'
     AND s.product_id              IS NULL
     AND s.product_origin_country_id IS NULL
),
si_pick AS (
  -- One shipment_item per snapshot. Per ambiguity check there is exactly one
  -- distinct (product_name, origin_country, variety) per (position_id,
  -- shipment_id) in scope, so DISTINCT ON is deterministic for the columns
  -- we read; ties on si.id only affect physical row choice, not the values.
  SELECT DISTINCT ON (sc.snapshot_id)
         sc.snapshot_id,
         lower(trim(si.product_name))    AS pn_norm,
         lower(trim(si.origin_country))  AS cn_norm,
         lower(trim(si.variety))         AS vn_norm
    FROM scope sc
    JOIN public.shipment_items si
      ON si.position_id = sc.position_id
     AND si.shipment_id = sc.source_shipment_id
   ORDER BY sc.snapshot_id, si.id
),
resolved AS (
  SELECT
    sp.snapshot_id,
    -- product_id: direct products.name (case-insensitive), then product_aliases→product_dictionary
    COALESCE(
      (SELECT p.id  FROM public.products p           WHERE lower(p.name) = sp.pn_norm LIMIT 1),
      (SELECT pd.id FROM public.product_aliases pa
                    JOIN public.product_dictionary pd
                      ON pd.canonical_product_id = pa.canonical_product_id
                   WHERE pa.alias_normalized = sp.pn_norm LIMIT 1)
    ) AS new_product_id,
    -- country_id: direct, then country_aliases
    COALESCE(
      (SELECT c.id FROM public.countries c       WHERE lower(c.name) = sp.cn_norm LIMIT 1),
      (SELECT c.id FROM public.country_aliases ca
                   JOIN public.countries c ON lower(c.name) = lower(ca.country_name)
                  WHERE ca.alias_normalized = sp.cn_norm LIMIT 1)
    ) AS new_country_id,
    sp.pn_norm, sp.vn_norm
  FROM si_pick sp
),
resolved2 AS (
  SELECT r.snapshot_id, r.new_product_id, r.new_country_id,
    CASE
      WHEN r.vn_norm IS NULL OR r.vn_norm = '' THEN NULL
      WHEN r.new_product_id IS NULL THEN NULL
      ELSE (
        SELECT pv.id
          FROM public.product_varieties pv
          JOIN public.product_dictionary pd
            ON lower(pd.product_name_ua) = lower(pv.product_name_ua)
         WHERE pd.id = r.new_product_id
           AND pv.variety_normalized = r.vn_norm
         LIMIT 1
      )
    END AS new_variety_id
  FROM resolved r
)
UPDATE public.archive_promise_snapshots s
   SET product_id                = r.new_product_id,
       product_origin_country_id = r.new_country_id,
       variety_id                = r.new_variety_id
  FROM resolved2 r
 WHERE s.snapshot_id = r.snapshot_id
   AND s.notes      = 'Test-data cleanup: ETA <= 2026-06-15 -> Delivered archive'
   AND s.source     = 'shipment_link'
   AND s.status     = 'resolved'
   AND s.resolution = 'delivered'
   AND s.product_id IS NULL
   AND s.product_origin_country_id IS NULL;
