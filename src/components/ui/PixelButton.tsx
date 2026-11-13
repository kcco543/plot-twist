import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { PixelIcon, type IconName } from "./PixelIcon";
import { LoadingDots } from "./LoadingDots";

/**
 * Candy button. One component, every state:
 * hover (lifts 1px, pointer devices only) · active (presses down, frame flips) ·
 * focus (dashed lavender ring) · disabled (flat, muted) · loading (dots + aria-busy).
 */
export type ButtonVariant = "primary" | "accent" | "success" | "magic" | "calm" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const FRAMES: Record<ButtonVariant, [string, string, string]> = {
  primary: ["pink", "pink-pressed", "var(--color-ink)"],
  accent: ["butter", "butter-pressed", "var(--color-ink)"],
  success: ["mint", "mint-pressed", "var(--color-ink)"],
  magic: ["lavender", "lavender-pressed", "var(--color-ink)"],
  calm: ["periwinkle", "periwinkle-pressed", "var(--color-ink)"],
  secondary: ["plum", "plum-pressed", "var(--color-ink)"],
  ghost: ["ghost", "ghost-pressed", "var(--color-ink-soft)"],
  danger: ["coral", "coral-pressed", "var(--color-ink)"],
};

const SIZES: Record<Size, string> = {
  sm: "min-h-11 px-1.5 text-[15px]",
  md: "min-h-12 px-3 text-[17px]",
  lg: "min-h-14 px-5 text-xl",
};

export const buttonStyle = (variant: ButtonVariant): CSSProperties =>
  ({
    "--frame": `var(--frame-${FRAMES[variant][0]})`,
    "--frame-pressed": `var(--frame-${FRAMES[variant][1]})`,
    "--ink": FRAMES[variant][2],
  }) as CSSProperties;

type Common = {
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

function Inner({ icon, iconRight, children, size = "md", loading }: Common & { loading?: boolean }) {
  const s = size === "lg" ? 16 : size === "md" ? 14 : 12;
  return (
    <>
      {icon && !loading && <PixelIcon name={icon} size={s} />}
      {children && <span className={loading ? "opacity-70" : undefined}>{children}</span>}
      {loading && <LoadingDots />}
      {iconRight && !loading && <PixelIcon name={iconRight} size={s} />}
    </>
  );
}

export function PixelButton({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  children,
  className = "",
  style,
  loading = false,
  type = "button",
  disabled,
  ...rest
}: Common & { loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`px-btn ${SIZES[size]} ${className}`}
      style={{ ...buttonStyle(variant), ...style }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Inner icon={icon} iconRight={iconRight} size={size} loading={loading}>
        {children}
      </Inner>
    </button>
  );
}

export function PixelLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  children,
  className = "",
  style,
  ...rest
}: Common & { href: string; "aria-label"?: string }) {
  return (
    <Link href={href} className={`px-btn ${SIZES[size]} ${className}`} style={{ ...buttonStyle(variant), ...style }} {...rest}>
      <Inner icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Inner>
    </Link>
  );
}
