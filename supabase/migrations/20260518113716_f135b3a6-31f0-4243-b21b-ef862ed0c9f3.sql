
-- 1. Columns
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS unloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS archive_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_shipments_unloaded_at ON public.shipments(unloaded_at);
CREATE INDEX IF NOT EXISTS idx_shipments_archived_at ON public.shipments(archived_at);
CREATE INDEX IF NOT EXISTS idx_shipments_cancelled_at ON public.shipments(cancelled_at);

-- 2. Cancelled archive table
CREATE TABLE IF NOT EXISTS public.cancelled_shipments_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL,
  shipment_code text NOT NULL,
  cancelled_at timestamptz NOT NULL,
  cancelled_by uuid,
  cancelled_by_name text,
  archived_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);
ALTER TABLE public.cancelled_shipments_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cancelled_archive read auth" ON public.cancelled_shipments_archive;
CREATE POLICY "cancelled_archive read auth" ON public.cancelled_shipments_archive
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cancelled_archive admin write" ON public.cancelled_shipments_archive;
CREATE POLICY "cancelled_archive admin write" ON public.cancelled_shipments_archive
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- 3. Helper: add hours excluding Sundays
CREATE OR REPLACE FUNCTION public.add_hours_excl_sunday(_from timestamptz, _hours integer)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  remaining integer := _hours;
  cur timestamptz := _from;
  step integer;
  is_sunday boolean;
BEGIN
  WHILE remaining > 0 LOOP
    is_sunday := EXTRACT(DOW FROM (cur AT TIME ZONE 'UTC'))::int = 0;
    IF is_sunday THEN
      -- jump to next day 00:00 UTC
      cur := date_trunc('day', cur AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day';
    ELSE
      step := LEAST(remaining, 1);
      cur := cur + (step || ' hours')::interval;
      remaining := remaining - step;
    END IF;
  END LOOP;
  RETURN cur;
END;
$$;

-- 4. Trigger: stamp cancelled_at / unloaded_at + compute archive_due_at
CREATE OR REPLACE FUNCTION public.shipments_lifecycle_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cancellation
  IF NEW.status = 'cancelled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
    NEW.archive_due_at := public.add_hours_excl_sunday(NEW.cancelled_at, 48);
  END IF;

  -- Unload (manual flip)
  IF NEW.unloaded_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.unloaded_at IS DISTINCT FROM NEW.unloaded_at) THEN
    NEW.archive_due_at := NEW.unloaded_at + interval '7 days';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_lifecycle_stamp ON public.shipments;
CREATE TRIGGER trg_shipments_lifecycle_stamp
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_lifecycle_stamp();

-- 5. Edit-lock trigger on shipments
CREATE OR REPLACE FUNCTION public.shipments_block_locked_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.unloaded_at IS NOT NULL OR OLD.status = 'cancelled' OR OLD.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.unloaded_at IS NOT NULL OR OLD.status = 'cancelled' OR OLD.archived_at IS NOT NULL) THEN
    -- Allow only the cancellation flip itself (status -> cancelled) if not already locked
    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' AND OLD.unloaded_at IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_block_locked_edits ON public.shipments;
CREATE TRIGGER trg_shipments_block_locked_edits
  BEFORE UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_block_locked_edits();

-- 6. Generic lock helper for child tables
CREATE OR REPLACE FUNCTION public.is_shipment_locked(_shipment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = _shipment_id
      AND (unloaded_at IS NOT NULL OR status = 'cancelled' OR archived_at IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.block_if_shipment_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.shipment_id ELSE NEW.shipment_id END;
  IF sid IS NOT NULL AND public.is_shipment_locked(sid) THEN
    RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_items_lock ON public.shipment_items;
CREATE TRIGGER trg_shipment_items_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.block_if_shipment_locked();

-- distributions
CREATE OR REPLACE FUNCTION public.block_if_distribution_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.shipment_id ELSE NEW.shipment_id END;
  IF sid IS NOT NULL AND public.is_shipment_locked(sid) THEN
    RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_distributions_lock ON public.distributions;
CREATE TRIGGER trg_distributions_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.distributions
  FOR EACH ROW EXECUTE FUNCTION public.block_if_distribution_locked();

-- distribution_items (lookup shipment via distribution)
CREATE OR REPLACE FUNCTION public.block_if_distribution_item_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  did uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  did := CASE WHEN TG_OP = 'DELETE' THEN OLD.distribution_id ELSE NEW.distribution_id END;
  SELECT shipment_id INTO sid FROM public.distributions WHERE id = did;
  IF sid IS NOT NULL AND public.is_shipment_locked(sid) THEN
    RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_distribution_items_lock ON public.distribution_items;
CREATE TRIGGER trg_distribution_items_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.distribution_items
  FOR EACH ROW EXECUTE FUNCTION public.block_if_distribution_item_locked();

-- branch_transfer_offers (lookup via shipment_item)
CREATE OR REPLACE FUNCTION public.block_if_bto_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  siid uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  siid := CASE WHEN TG_OP = 'DELETE' THEN OLD.shipment_item_id ELSE NEW.shipment_item_id END;
  SELECT shipment_id INTO sid FROM public.shipment_items WHERE id = siid;
  IF sid IS NOT NULL AND public.is_shipment_locked(sid) THEN
    RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_bto_lock ON public.branch_transfer_offers;
CREATE TRIGGER trg_bto_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.branch_transfer_offers
  FOR EACH ROW EXECUTE FUNCTION public.block_if_bto_locked();

-- manager_offers: block edits when linked_shipment is locked
CREATE OR REPLACE FUNCTION public.block_if_manager_offer_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.linked_shipment_id ELSE NEW.linked_shipment_id END;
  IF sid IS NOT NULL AND public.is_shipment_locked(sid) THEN
    RAISE EXCEPTION 'Поставка розвантажена/скасована — редагування заблоковано';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_offers_lock ON public.manager_offers;
CREATE TRIGGER trg_manager_offers_lock
  BEFORE UPDATE OR DELETE ON public.manager_offers
  FOR EACH ROW EXECUTE FUNCTION public.block_if_manager_offer_locked();

-- 7. Archive RPC for cancelled shipments (snapshot + mark archived)
CREATE OR REPLACE FUNCTION public.archive_due_cancelled_shipments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  n integer := 0;
  snap jsonb;
  cancelled_name text;
BEGIN
  FOR rec IN
    SELECT * FROM public.shipments
     WHERE status = 'cancelled'
       AND archived_at IS NULL
       AND archive_due_at IS NOT NULL
       AND archive_due_at <= now()
  LOOP
    SELECT COALESCE(p.full_name, im.full_name)
      INTO cancelled_name
      FROM public.profiles p
      FULL JOIN public.import_managers im ON im.user_id = rec.cancelled_by
      WHERE p.id = rec.cancelled_by
      LIMIT 1;

    SELECT jsonb_build_object(
      'shipment', to_jsonb(rec.*),
      'supplier', (SELECT to_jsonb(s.*) FROM public.suppliers s WHERE s.id = rec.supplier_id),
      'manager', (SELECT to_jsonb(im.*) FROM public.import_managers im WHERE im.id = rec.import_manager_id),
      'items', COALESCE((SELECT jsonb_agg(to_jsonb(si.*)) FROM public.shipment_items si WHERE si.shipment_id = rec.id), '[]'::jsonb),
      'distributions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'distribution', to_jsonb(d.*),
          'items', COALESCE((SELECT jsonb_agg(to_jsonb(di.*)) FROM public.distribution_items di WHERE di.distribution_id = d.id), '[]'::jsonb)
        ))
        FROM public.distributions d WHERE d.shipment_id = rec.id
      ), '[]'::jsonb)
    ) INTO snap;

    INSERT INTO public.cancelled_shipments_archive(shipment_id, shipment_code, cancelled_at, cancelled_by, cancelled_by_name, snapshot)
    VALUES (rec.id, rec.code, rec.cancelled_at, rec.cancelled_by, cancelled_name, snap);

    UPDATE public.shipments SET archived_at = now() WHERE id = rec.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- 8. Auto-unload + archive unloaded
CREATE OR REPLACE FUNCTION public.auto_unload_shipments()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.shipments
       SET unloaded_at = now()
     WHERE eta IS NOT NULL
       AND eta < CURRENT_DATE
       AND unloaded_at IS NULL
       AND status NOT IN ('cancelled')
       AND archived_at IS NULL
     RETURNING id
  ) SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_due_unloaded_shipments()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.shipments
       SET archived_at = now()
     WHERE unloaded_at IS NOT NULL
       AND archived_at IS NULL
       AND archive_due_at IS NOT NULL
       AND archive_due_at <= now()
       AND status <> 'cancelled'
     RETURNING id
  ) SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;
