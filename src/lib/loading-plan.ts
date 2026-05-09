export type LoadingPlanMatchRow = {
  product_name: string;
  country: string | null;
  count_existing: boolean;
  created_at: string;
};

export type LoadedPlanCandidate = {
  product_name: string | null;
  origin_country?: string | null;
  pallet_count: number | null;
  created_at?: string | null;
  shipments?: {
    country: string | null;
    created_at: string | null;
  } | null;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function getCandidateCountry(item: LoadedPlanCandidate) {
  return normalize(item.origin_country ?? item.shipments?.country ?? null);
}

function getCandidateCreatedAt(item: LoadedPlanCandidate) {
  return item.created_at ?? item.shipments?.created_at ?? null;
}

export function matchesLoadingPlanRow(plan: LoadingPlanMatchRow, item: LoadedPlanCandidate) {
  if (normalize(item.product_name) !== normalize(plan.product_name)) return false;

  const planCountry = normalize(plan.country);
  if (planCountry && getCandidateCountry(item) !== planCountry) return false;

  if (!plan.count_existing) {
    const createdAt = getCandidateCreatedAt(item);
    if (!createdAt || createdAt < plan.created_at) return false;
  }

  return true;
}

export function countLoadedPallets(plan: LoadingPlanMatchRow, items: LoadedPlanCandidate[]) {
  return items
    .filter((item) => matchesLoadingPlanRow(plan, item))
    .reduce((sum, item) => sum + Number(item.pallet_count ?? 0), 0);
}