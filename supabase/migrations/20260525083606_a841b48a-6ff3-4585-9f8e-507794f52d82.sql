
-- =========================================================
-- POSITION ID CORE — schema-only migration #1
-- Empty tables only. No data migration. No UI wiring.
-- RLS enabled, no policies (deny-by-default).
-- FK types verified against existing schema (all uuid).
-- =========================================================

-- ---------- operational_positions ----------
CREATE TABLE public.operational_positions (
  position_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id               uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_origin_country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE RESTRICT,
  supplier_id              uuid NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  variety_id               bigint NULL REFERENCES public.product_varieties(id) ON DELETE RESTRICT,
  caliber                  text NULL,
  packaging                text NULL,
  pallet_qty               numeric NULL,
  owner_user_id            uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by               uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  current_status           text NOT NULL DEFAULT 'draft',
  source_context           text NULL,
  source_row_key           text NULL,
  client_row_id            uuid NULL,
  notes                    text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT op_pos_pallet_qty_chk CHECK (pallet_qty IS NULL OR pallet_qty >= 0)
);

CREATE INDEX op_pos_product_country_idx
  ON public.operational_positions (product_id, product_origin_country_id);
CREATE INDEX op_pos_owner_idx ON public.operational_positions (owner_user_id);
CREATE INDEX op_pos_status_idx ON public.operational_positions (current_status);
CREATE INDEX op_pos_supplier_idx ON public.operational_positions (supplier_id);

-- Idempotency-only unique. Does NOT auto-merge business duplicates.
CREATE UNIQUE INDEX op_pos_idem_uq
  ON public.operational_positions (source_context, source_row_key)
  WHERE source_context IS NOT NULL AND source_row_key IS NOT NULL;

ALTER TABLE public.operational_positions ENABLE ROW LEVEL SECURITY;

-- ---------- position_branch_allocations ----------
CREATE TABLE public.position_branch_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id     uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  requested_qty   numeric NOT NULL DEFAULT 0,
  approved_qty    numeric NOT NULL DEFAULT 0,
  ordered_qty     numeric NOT NULL DEFAULT 0,
  cancelled_qty   numeric NOT NULL DEFAULT 0,
  remaining_qty   numeric GENERATED ALWAYS AS (approved_qty - ordered_qty - cancelled_qty) STORED,
  status          text NOT NULL DEFAULT 'requested',
  -- requested | approved | partially_approved | rejected | ordered | cancelled
  decision_notes  text NULL,
  decided_at      timestamptz NULL,
  decided_by      uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pba_requested_nn CHECK (requested_qty >= 0),
  CONSTRAINT pba_approved_nn  CHECK (approved_qty  >= 0),
  CONSTRAINT pba_ordered_nn   CHECK (ordered_qty   >= 0),
  CONSTRAINT pba_cancelled_nn CHECK (cancelled_qty >= 0),
  CONSTRAINT pba_approved_covers_ordered_cancelled
    CHECK (approved_qty >= ordered_qty + cancelled_qty),
  CONSTRAINT pba_status_chk CHECK (status IN
    ('requested','approved','partially_approved','rejected','ordered','cancelled')),
  UNIQUE (position_id, branch_id)
);

CREATE INDEX pba_position_idx ON public.position_branch_allocations (position_id);
CREATE INDEX pba_branch_idx   ON public.position_branch_allocations (branch_id);

ALTER TABLE public.position_branch_allocations ENABLE ROW LEVEL SECURITY;

-- ---------- position_shipment_links ----------
CREATE TABLE public.position_shipment_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id       uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  shipment_id       uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  pallet_qty_linked numeric NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT psl_pallet_qty_pos CHECK (pallet_qty_linked > 0)
);

CREATE INDEX psl_position_idx ON public.position_shipment_links (position_id);
CREATE INDEX psl_shipment_idx ON public.position_shipment_links (shipment_id);

ALTER TABLE public.position_shipment_links ENABLE ROW LEVEL SECURITY;

-- ---------- position_logistics_legs ----------
CREATE TABLE public.position_logistics_legs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id     uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  shipment_id     uuid NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  vehicle_id      uuid NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  leg_number      integer NOT NULL,
  planned_qty     numeric NULL,
  actual_qty      numeric NULL,
  planned_date    date NULL,
  actual_date     date NULL,
  notes           text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pll_planned_nn CHECK (planned_qty IS NULL OR planned_qty >= 0),
  CONSTRAINT pll_actual_nn  CHECK (actual_qty  IS NULL OR actual_qty  >= 0),
  UNIQUE (position_id, leg_number)
);

CREATE INDEX pll_position_idx ON public.position_logistics_legs (position_id);
CREATE INDEX pll_shipment_idx ON public.position_logistics_legs (shipment_id);

ALTER TABLE public.position_logistics_legs ENABLE ROW LEVEL SECURITY;

-- ---------- position_events (created before cost_current to allow nullable FK without circularity) ----------
CREATE TABLE public.position_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id  uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  event_type   text NOT NULL,
  payload      jsonb NULL,
  actor_id     uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pe_position_idx ON public.position_events (position_id);
CREATE INDEX pe_created_idx  ON public.position_events (created_at);

ALTER TABLE public.position_events ENABLE ROW LEVEL SECURITY;

-- ---------- position_status_history ----------
CREATE TABLE public.position_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id   uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  from_status   text NULL,
  to_status     text NOT NULL,
  changed_by    uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason        text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX psh_position_idx ON public.position_status_history (position_id);
CREATE INDEX psh_created_idx  ON public.position_status_history (created_at);

ALTER TABLE public.position_status_history ENABLE ROW LEVEL SECURITY;

-- ---------- position_cost_current ----------
CREATE TABLE public.position_cost_current (
  position_id           uuid PRIMARY KEY REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  indicative_cost_usd   numeric NULL,
  invoice_cost_usd      numeric NULL,
  fx_rate_snapshot      numeric NULL,
  fx_rate_date          date NULL,
  source_event_id       uuid NULL REFERENCES public.position_events(id) ON DELETE RESTRICT,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.position_cost_current ENABLE ROW LEVEL SECURITY;

-- ---------- position_cost_history ----------
CREATE TABLE public.position_cost_history (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id           uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  indicative_cost_usd   numeric NULL,
  invoice_cost_usd      numeric NULL,
  fx_rate_snapshot      numeric NULL,
  fx_rate_date          date NULL,
  source_event_id       uuid NULL REFERENCES public.position_events(id) ON DELETE RESTRICT,
  reason                text NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pch_position_idx ON public.position_cost_history (position_id);
CREATE INDEX pch_created_idx  ON public.position_cost_history (created_at);

ALTER TABLE public.position_cost_history ENABLE ROW LEVEL SECURITY;

-- ---------- shipment_readiness_checks ----------
CREATE TABLE public.shipment_readiness_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  check_type    text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  notes         text NULL,
  checked_by    uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  checked_at    timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX src_shipment_idx ON public.shipment_readiness_checks (shipment_id);

ALTER TABLE public.shipment_readiness_checks ENABLE ROW LEVEL SECURITY;

-- ---------- position_split_links (skeleton) ----------
CREATE TABLE public.position_split_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_position_id  uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  child_position_id   uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  split_reason        text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  UNIQUE (parent_position_id, child_position_id),
  CONSTRAINT psl_no_self_split CHECK (parent_position_id <> child_position_id)
);

CREATE INDEX psl_parent_idx ON public.position_split_links (parent_position_id);
CREATE INDEX psl_child_idx  ON public.position_split_links (child_position_id);

ALTER TABLE public.position_split_links ENABLE ROW LEVEL SECURITY;

-- ---------- position_documents (skeleton) ----------
CREATE TABLE public.position_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id  uuid NOT NULL REFERENCES public.operational_positions(position_id) ON DELETE RESTRICT,
  doc_type     text NOT NULL,
  storage_path text NULL,
  external_url text NULL,
  notes        text NULL,
  uploaded_by  uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pd_position_idx ON public.position_documents (position_id);

ALTER TABLE public.position_documents ENABLE ROW LEVEL SECURITY;
