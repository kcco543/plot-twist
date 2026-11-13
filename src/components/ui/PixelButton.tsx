import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { PixelIcon, type IconName } from "./PixelIcon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, CSSProperties> = {
  primary: { "--face": "var(--color-twist)", "--edge": "var(--color-twist-dark)" } as CSSProperties,
  secondary: { "--face": "var(--color-ink-700)", "--edge": "var(--color-ink-950)" } as CSSProperties,
  ghost: {
    "--face": "var(--color-ink-900)",
    "--edge": "var(--color-ink-800)",
    "--frame": "var(--color-ink-400)",
  } as CSSProperties,
  danger: {
    "--face": "var(--color-ink-900)",
    "--edge": "var(--color-ink-800)",
    "--frame": "var(--color-twist)",
    "--ink": "var(--color-twist)",
  } as CSSProperties,
  accent: {
    "--face": "var(--color-sun)",
    "--edge": "var(--color-sun-dark)",
    "--ink": "var(--color-ink-950)",
  } as CSSProperties,
};

const SIZES: Record<Size, string> = {
  sm: "text-[10px] px-3 py-2 min-h-9",
  md: "text-xs px-5 py-3 min-h-12",
  lg: "text-sm sm:text-base px-7 py-4 min-h-14",
};

type Common = {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

function Inner({ icon, iconRight, children, size = "md" }: Common) {
  const s = size === "lg" ? 16 : size === "md" ? 14 : 12;
  return (
    <>
      {icon && <PixelIcon name={icon} size={s} />}
      {children && <span className="leading-none pt-[2px]">{children}</span>}
      {iconRight && <PixelIcon name={iconRight} size={s} />}
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
  type = "button",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`px-btn ${SIZES[size]} ${className}`}
      style={{ ...VARIANTS[variant], ...style }}
      {...rest}
    >
      <Inner icon={icon} iconRight={iconRight} size={size}>
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
    <Link href={href} className={`px-btn ${SIZES[size]} ${className}`} style={{ ...VARIANTS[variant], ...style }} {...rest}>
      <Inner icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Inner>
    </Link>
  );
}
