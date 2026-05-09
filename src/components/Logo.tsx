import { cn } from "@/lib/utils";
import logoSrc from "@/assets/tropik-logo.png";

/**
 * TROPIK logo. The source asset has a white background, so we render it
 * inside a white rounded container that sits harmoniously on any surface
 * (light or dark). Use `mark` for the compact square badge (e.g. header
 * avatar) and the default for a wider "card" with the full lockup.
 */
export function Logo({
  className,
  mark = false,
  size,
}: {
  className?: string;
  mark?: boolean;
  size?: number;
}) {
  if (mark) {
    return (
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5",
          className,
        )}
      >
        <img
          src={logoSrc}
          alt="TROPIK"
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-black/5",
        className,
      )}
      style={size ? { width: size } : undefined}
    >
      <img
        src={logoSrc}
        alt="TROPIK Ukraine — Fruit, Vegetables, Import, Export"
        className="h-auto w-full object-contain"
        draggable={false}
      />
    </div>
  );
}
