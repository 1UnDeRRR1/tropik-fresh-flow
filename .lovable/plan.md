
## Scope (strict)

Edit only:
- `src/components/AppShell.tsx` — minimal additions for 4 owner mobile tabs
- New assets: `src/assets/nav-icons/owner/` (8 PNG files)

Do NOT touch: styles.css, header, owner mobile banner, body bg, owner-settings-bg.png, layout, routes, other roles, other pages, desktop nav, backend, DB, RLS, auth, RPC, formulas, position_id, badge logic, pb-safe, bg-card/95, owner /settings bg-[#f3eadc]/85.

## Step 1 — Generate 8 PNG icons (Variant 1: pencil sketch ↔ muted color)

Path: `src/assets/nav-icons/owner/`
Size: 512×512 transparent PNG (rendered at 28×28 CSS).
Style: hand-drawn graphite pencil sketch on transparent canvas; mono uses soft graphite (#3a3a3a-ish); color uses muted watercolor/pencil tints — identical geometry to mono, only differs in fill/tint.

Files:
- `calendar-mono.png` / `calendar-color.png` — desk calendar with spiral
- `analytics-mono.png` / `analytics-color.png` — 3 bars + trend arrow
- `statistics-mono.png` / `statistics-color.png` — pie chart
- `profile-mono.png` / `profile-color.png` — bust silhouette

Active palette (muted, no neon): warm amber, sage, terracotta, dusty blue — picked to feel like one set.

## Step 2 — Edit `src/components/AppShell.tsx`

Add imports for 8 assets + a map keyed by pathname:

```ts
import calendarMono from "@/assets/nav-icons/owner/calendar-mono.png";
import calendarColor from "@/assets/nav-icons/owner/calendar-color.png";
// ...same for analytics, statistics, profile

const ownerNavIcons: Record<string, { mono: string; color: string; activeColor: string }> = {
  "/owner/calendar":   { mono: calendarMono,   color: calendarColor,   activeColor: "#b07a3a" },
  "/owner/analytics":  { mono: analyticsMono,  color: analyticsColor,  activeColor: "#6b8a5a" },
  "/owner/statistics": { mono: statisticsMono, color: statisticsColor, activeColor: "#a8624a" },
  "/settings":         { mono: profileMono,    color: profileColor,    activeColor: "#5a7a92" },
};
```

In the mobile bottom-nav `NavItem` render path, for owner role only, if the item's `to` matches a key in `ownerNavIcons`:
- replace the lucide `<Icon />` with `<img src={isActive ? color : mono} width={28} height={28} alt="" />`
- apply pencil-style class to the existing label span: inactive → `text-[#5a5048] font-light tracking-wide` (graphite); active → inline `style={{ color: activeColor }}` + same weight/tracking
- pick a handwritten-looking system fallback stack via inline `fontFamily: '"Caveat", "Patrick Hand", "Bradley Hand", cursive'` (Caveat/Patrick Hand are not installed — fallback chain ends at `cursive`, system handwriting fonts render on iOS/Android)

No layout/grid/padding/pb-safe/bg changes. Other tabs / other roles / desktop sidebar untouched.

## Step 3 — QA

Screenshot owner mobile bottom nav at 440×612 showing inactive (mono pencil + graphite label) and active state (color icon + muted colored label). If 28×28 + labels look cramped/illegible → STOP, do not change layout, report back proposing an auto-hide expandable panel as a separate task.

## Deliverables in reply

1. Changed files list
2. Names of 8 created assets
3. Final AppShell snippet wiring owner icons + labels
4. Screenshot of owner mobile bottom nav
5. Confirmation nothing else changed
