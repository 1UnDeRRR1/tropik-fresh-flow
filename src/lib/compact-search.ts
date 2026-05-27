export function matchesWordStart(value: string, query: string) {
  const source = value.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!source || !q) return false;
  if (source.startsWith(q)) return true;
  return source
    .split(/[\s/.,;:()\[\]{}+\-_]+/)
    .filter(Boolean)
    .some((word) => word.startsWith(q));
}

export function filterWordStart<T>(items: T[], getLabel: (item: T) => string, query: string, limit = 3) {
  const q = query.trim().toLowerCase();
  const source = q
    ? items.filter((item) => matchesWordStart(getLabel(item), q))
    : items;
  return source.slice(0, limit);
}