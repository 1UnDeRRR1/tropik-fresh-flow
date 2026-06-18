import { useEffect, useRef } from "react";
import "./velvet-cosmic-create-button.css";

type VelvetCosmicCreateButtonProps = {
  label?: string;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
};

export function VelvetCosmicCreateButton({
  label = "+Створити",
  className = "",
  disabled = false,
  type = "button",
  onClick,
}: VelvetCosmicCreateButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const burstTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current) {
        window.clearTimeout(burstTimerRef.current);
      }
    };
  }, []);

  const setPressPoint = (event: React.PointerEvent<HTMLButtonElement>) => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    button.style.setProperty("--press-x", `${Math.max(0, Math.min(100, x))}%`);
    button.style.setProperty("--press-y", `${Math.max(0, Math.min(100, y))}%`);
  };

  const triggerBurst = (event: React.PointerEvent<HTMLButtonElement>) => {
    const button = buttonRef.current;
    if (!button || disabled) return;

    setPressPoint(event);

    if (burstTimerRef.current) {
      window.clearTimeout(burstTimerRef.current);
    }

    button.classList.remove("is-bursting");
    void button.offsetWidth;
    button.classList.add("is-bursting");

    burstTimerRef.current = window.setTimeout(() => {
      button.classList.remove("is-bursting");
      button.style.setProperty("--press-x", "50%");
      button.style.setProperty("--press-y", "50%");
    }, 4500);
  };

  return (
    <button
      ref={buttonRef}
      className={`velvet-cosmic-button ${className}`.trim()}
      type={type}
      disabled={disabled}
      onPointerDown={triggerBurst}
      onClick={onClick}
    >
      <span className="velvet-cosmic-press-bloom" aria-hidden="true" />
      <span className="velvet-cosmic-label">{label}</span>
    </button>
  );
}
