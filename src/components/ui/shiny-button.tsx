import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

import { cn } from "@/lib/utils";

/**
 * Ruixen / MagicUI "Shiny Button" — visual port from
 * https://21st.dev/community/components/magicui/shiny-button/default
 *
 * Implementation note: the project's `--primary` token is stored as an
 * `oklch(...)` color, not as raw `H S L` channels, so the original
 * `hsl(var(--primary))` form produced invalid CSS and the shine was
 * completely invisible. We use `var(--primary)` directly for solid stops
 * and `color-mix(in oklab, var(--primary) X%, transparent)` for the
 * translucent stops — both render correctly with any color space.
 */

const animationProps = {
  initial: { "--x": "100%", scale: 0.8 },
  animate: { "--x": "-100%", scale: 1 },
  whileTap: { scale: 0.95 },
  transition: {
    repeat: Infinity,
    repeatType: "loop",
    repeatDelay: 1,
    type: "spring",
    stiffness: 20,
    damping: 15,
    mass: 2,
    scale: {
      type: "spring",
      stiffness: 200,
      damping: 5,
      mass: 0.5,
    },
  },
} as const;

const labelMask =
  "linear-gradient(-75deg, var(--primary) calc(var(--x) + 20%), transparent calc(var(--x) + 30%), var(--primary) calc(var(--x) + 100%))";

const ringGradient =
  "linear-gradient(-75deg, color-mix(in oklab, var(--primary) 10%, transparent) calc(var(--x) + 20%), color-mix(in oklab, var(--primary) 50%, transparent) calc(var(--x) + 25%), color-mix(in oklab, var(--primary) 10%, transparent) calc(var(--x) + 100%))";

export interface ShinyButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  children: React.ReactNode;
  className?: string;
}

export const ShinyButton = React.forwardRef<HTMLButtonElement, ShinyButtonProps>(
  ({ children, className, type = "button", style, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        type={type}
        {...animationProps}
        {...props}
        style={{ ...(style as React.CSSProperties), ["--x" as string]: "100%" }}
        className={cn(
          "relative rounded-lg px-6 py-2 font-medium backdrop-blur-xl transition-shadow duration-300 ease-in-out hover:shadow dark:hover:shadow-[0_0_20px_color-mix(in_oklab,var(--primary)_10%,transparent)]",
          className,
        )}
      >
        <span
          className="relative block size-full text-sm uppercase tracking-wide text-[rgb(0,0,0,65%)] dark:font-light dark:text-[rgb(255,255,255,90%)]"
          style={{
            maskImage: labelMask,
            WebkitMaskImage: labelMask,
          }}
        >
          {children}
        </span>
        <span
          aria-hidden="true"
          style={{
            mask: "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
            WebkitMask:
              "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
            maskComposite: "exclude",
            WebkitMaskComposite: "xor",
            backgroundImage: ringGradient,
          }}
          className="absolute inset-0 z-10 block rounded-[inherit] p-px"
        />
      </motion.button>
    );
  },
);
ShinyButton.displayName = "ShinyButton";

export default ShinyButton;
