
# Final UPDATE Preview — customs_reference (175 rows)

NOTHING APPLIED. NO MIGRATION RUN. NO DB WRITE. Read-only artifacts only.

## A. Rows to update
**175** rows (all uniquely matched by `id` in live `public.customs_reference`).

## B. Fields that will be updated
Per row, only these four columns + `updated_at`:
- `threshold_price_usd` — changes in **109 / 175** rows
- `customs_fee_percent` — changes in **3 / 175** rows
- `euro1_percent` — changes in **50 / 175** rows
- `euro1_markup_usd` — changes in **175 / 175** rows (this was the trigger field)

No other columns touched. No `active`, no `product_name`, no `country`, no `id`.

## C. Blank-protection rule (confirmed)

For every row the new value is computed as:
```
new_value = COALESCE(prep.upload_<field>, live.<field>)
```
If the prep cell is `NULL`/blank, the **live value is preserved** — never overwritten with NULL.

Prep blanks observed (kept from live):
- `upload_threshold_price_usd` NULL: 0
- `upload_customs_fee_percent` NULL: 21 → these 21 keep their current `customs_fee_percent`
- `upload_euro1_percent` NULL: 49 → these 49 keep their current `euro1_percent` (this is the `B_flat` issue you flagged: 69 prep rows come from `B_flat`, which has no euro1_percent column; 49 of them are NULL and protected, 20 had a value carried in from `A_grouped` peer)
- `upload_euro1_markup_usd` NULL: 0

## D. Artifacts (review before approval)

- `customs_update_preview_2026-06-09.csv` — full 175-row diff table with columns:
  `id, product_name, country, old_threshold_price_usd, new_threshold_price_usd, old_customs_fee_percent, new_customs_fee_percent, old_euro1_percent, new_euro1_percent, old_euro1_markup_usd, new_euro1_markup_usd, delta_euro1_markup_usd, source_structure, current_source_row, new_file_row, fields_changed, comment`
- `customs_update_preview_2026-06-09.sql` — full UPDATE preview (CTE/VALUES whitelist by `id`)
- `customs_update_rollback_2026-06-09.sql` — rollback UPDATE built from current live values (snapshotted before any change)
- `customs_update_targets_2026-06-09.csv` — original 175-id whitelist (unchanged from prior step)

<presentation-artifact path="customs_update_preview_2026-06-09.csv" mime_type="text/csv"></presentation-artifact>
<presentation-artifact path="customs_update_preview_2026-06-09.sql" mime_type="application/sql"></presentation-artifact>
<presentation-artifact path="customs_update_rollback_2026-06-09.sql" mime_type="application/sql"></presentation-artifact>

## E. SQL/migration preview (shape)

```sql
-- Pre-checks (run manually before apply, expect 175/175/175):
SELECT count(*) FROM public.customs_reference
 WHERE id IN ( /* 175 whitelisted ids */ );                -- expected 175
SELECT count(*) FROM public.customs_reference
 WHERE id IN ( /* 175 whitelisted ids */ ) AND active;      -- expected 175

-- Apply (full SQL with all 175 tuples is in the .sql artifact):
WITH whitelist(id, new_threshold_price_usd, new_customs_fee_percent,
               new_euro1_percent, new_euro1_markup_usd) AS (VALUES
  ('a5e9a3a9-4bea-4d97-92bd-3fd282b5b133'::uuid, 4.5, 3.0, 3.0, 0.925),
  ('fae77276-7dea-4223-a58c-33fae757be6e'::uuid, 2.02, 5.0, 3.0, 0.502),
  -- … 173 more rows, one per id …
)
UPDATE public.customs_reference c
SET threshold_price_usd = w.new_threshold_price_usd,
    customs_fee_percent = w.new_customs_fee_percent,
    euro1_percent       = w.new_euro1_percent,
    euro1_markup_usd    = w.new_euro1_markup_usd,
    updated_at          = now()
FROM whitelist w
WHERE c.id = w.id;
```

Properties:
- UPDATE only, by `id`.
- Exactly 175 ids, all from the approved whitelist.
- No `INSERT`, no `DELETE`, no `active=false`.
- No `ALTER TABLE`, no RLS / RPC / trigger / GRANT / schema changes.
- No new columns, no rename, no index changes.
- Blank prep cells produce identity assignments (new=old) — value-safe.

## F. Control SELECTs (text-only, run before apply; stop if any mismatch)

```sql
-- 1) Whitelist count
SELECT 175 AS expected, count(*) AS actual
FROM (VALUES /* 175 ids */) v(id);
-- expected = actual = 175, else STOP

-- 2) Live rows matched
SELECT count(*) FROM public.customs_reference
WHERE id IN (/* 175 ids */);
-- expected 175, else STOP

-- 3) Active live rows matched
SELECT count(*) FROM public.customs_reference
WHERE id IN (/* 175 ids */) AND active = true;
-- expected 175, else STOP

-- 4) Post-apply verification
SELECT count(*) FROM public.customs_reference c
JOIN whitelist w ON w.id = c.id
WHERE c.euro1_markup_usd = w.new_euro1_markup_usd
  AND c.threshold_price_usd = w.new_threshold_price_usd
  AND c.customs_fee_percent = w.new_customs_fee_percent
  AND c.euro1_percent       = w.new_euro1_percent;
-- expected 175
```

## G. Rollback plan

A full reverse-UPDATE is pre-built from the current live snapshot in
`customs_update_rollback_2026-06-09.sql` — same shape, same 175 ids, but
values are the **current** (pre-apply) `threshold_price_usd`,
`customs_fee_percent`, `euro1_percent`, `euro1_markup_usd`. Running it
restores all 175 rows byte-for-byte. Snapshot taken from the same live
data the preview is built against, so rollback is exact as long as no
other writer touches these ids between preview and apply.

If extra safety is wanted, we can also dump the 175 affected rows to a
pre-apply CSV during the apply turn (no schema change, audit-only).

## H. What is explicitly NOT in this preview

- DUP_KEY_SUMMARY / DUP_REVIEW_ROWS — untouched
- NEW_ONLY_ADD — not inserted
- CURRENT_MISSING — not deactivated
- Manual review pairs (Капуста Білоголова/Білокачанна, Молода, Ківі/Ківі(фас)) — untouched
- No RLS / RPC / trigger / GRANT / schema / index / enum / migration-structure changes
- No code, UI, formulas, `position_id` lifecycle, cost roll-up changes

## I. Confirmation

**Nothing has been applied.** The three artifacts above are the entire
deliverable of this turn. The migration will only be created and submitted
for approval after your explicit OK on this preview.

## Next step

Reply with either `OK apply` (I will then create the migration with the
full 175-row CTE in a single Build/Apply turn, exactly matching the SQL
artifact) or send edits.
