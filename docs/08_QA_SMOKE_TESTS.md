# 08 — QA Smoke Tests

Manual smoke checklist after risky changes. Run the sections relevant to the change; if in doubt, run all.

## Role visibility
- [ ] super_admin sees admin/super-admin areas and activity screen.
- [ ] admin sees operational data without DB powers.
- [ ] import_manager sees own positions/shipments and supplier/cost fields for their scope.
- [ ] branch sees only own assigned/distributed items; **no** supplier/purchase/FX/customs/transport/internal-cost fields.
- [ ] logistics sees logistics/routing data only.
- [ ] broker sees customs-relevant data only.

## Manager flow
- [ ] Create draft shipment from accepted offers.
- [ ] Attach offer to existing `position_id` without minting a new identity.
- [ ] Assign responsible manager; verify visibility on branch screens.

## Branch flow
- [ ] Branch dashboard loads without runtime errors.
- [ ] Branch sees own goods via `shipments_branch` / `shipment_items_branch`.
- [ ] Branch requests and offers screens load and only show own data.
- [ ] Branch calendar renders own items.

## Logistics flow
- [ ] Loading plan opens, assignments persist.
- [ ] Vehicle / driver / route fields editable per permissions.
- [ ] Country fields remain distinct (origin / supplier / loading / shipment-vehicle).

## Broker flow
- [ ] Customs status fields editable where allowed.
- [ ] No purchase or internal-cost fields visible.

## Cost / net / gross
- [ ] Cost roll-up per position matches expected formula.
- [ ] Net vs gross vs pallet weight not conflated.
- [ ] FX rate badge reflects active rate.

## Mobile workflow
- [ ] Login on mobile viewport works.
- [ ] AppShell navigation usable at 360–440 CSS px width.
- [ ] Forms (offer, request, distribution) usable with on-screen keyboard.
- [ ] No horizontal overflow on key screens.

## Auth / activity
- [ ] Login, signup, logout work.
- [ ] Activity heartbeat fires for authenticated users.
- [ ] super_admin activity screen lists sessions; close-stale works.
- [ ] anon and PUBLIC cannot call activity RPCs.
