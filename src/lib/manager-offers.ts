export type ManagerOfferStatus =
  | "draft"
  | "active"
  | "in_work"
  | "confirmed"
  | "linked"
  | "closed"
  | "expired"
  | "deleted";

export const STATUS_LABEL: Record<ManagerOfferStatus, string> = {
  draft: "Чернетка",
  active: "Активна",
  in_work: "В опрацюванні",
  confirmed: "Підтверджено",
  linked: "Замовлено",
  closed: "Підтверджено",
  expired: "Прострочено",
  deleted: "Скасовано",
};

export const STATUS_CLASS: Record<ManagerOfferStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success/15 text-success",
  in_work: "bg-info/15 text-info",
  confirmed: "bg-warning/15 text-warning",
  linked: "bg-primary/15 text-primary",
  closed: "bg-warning/15 text-warning",
  expired: "bg-destructive/15 text-destructive",
  deleted: "bg-destructive/15 text-destructive",
};

export type ManagerOffer = {
  id: string;
  created_by: string;
  import_manager_id: string | null;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  packaging: string | null;
  specification: string | null;
  variety: string | null;
  indicative_cost_usd: number | null;
  invoice_cost_usd: number | null;
  prev_indicative_cost_usd: number | null;
  prev_invoice_cost_usd: number | null;
  offered_pallets: number | null;
  expires_at: string | null;
  expected_eta: string | null;
  status: ManagerOfferStatus;
  linked_shipment_id: string | null;
  notes: string | null;
  target_mode: "all" | "selected";
  created_at: string;
  updated_at: string;
  /** Net per pallet (kg). Required pair with pallet_gross_kg. */
  pallet_net_kg: number | null;
  /** Gross per pallet (kg). Must be strictly > pallet_net_kg. */
  pallet_gross_kg: number | null;
  /** Confirmed RED-stage manual customs duty in USD/kg. */
  customs_override_duty_usd: number | null;
  /** Timestamp of last confirmed manual customs override. */
  customs_override_confirmed_at: string | null;
};

export type ManagerOfferTarget = {
  id: string;
  offer_id: string;
  branch_id: string;
};

export type ManagerOfferResponse = {
  id: string;
  offer_id: string;
  branch_id: string;
  requested_pallets: number;
  approved_pallets: number | null;
  prev_approved_pallets: number | null;
  refused_at: string | null;
  refused_by: string | null;
  created_at: string;
  updated_at: string;
};

export function isExpired(o: Pick<ManagerOffer, "expires_at" | "status">): boolean {
  if (o.status === "expired") return true;
  if (!o.expires_at) return false;
  return new Date(o.expires_at).getTime() < Date.now();
}

export function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "минув";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} год ${mm} хв`;
}

/**
 * Shared Net/Gross validity helper.
 * Both values must be finite, net > 0, and gross strictly greater than net.
 * gross === net is INVALID.
 */
export function isValidNetGross(
  net: number | string | null | undefined,
  gross: number | string | null | undefined,
): boolean {
  if (net == null || gross == null || net === "" || gross === "") return false;
  const n = Number(net);
  const g = Number(gross);
  return Number.isFinite(n) && Number.isFinite(g) && n > 0 && g > n;
}

/** Ukrainian toast/error message for invalid saved offer Net/Gross. */
export const NET_GROSS_INVALID_MSG =
  "У пропозиції не заповнено коректні нетто та брутто. Спочатку відредагуйте пропозицію.";
