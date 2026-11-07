import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface CommonProps {
  variant?: Variant;
  withArrow?: boolean;
  children: ReactNode;
  className?: string;
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;
type AnchorProps = CommonProps & {
  href: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'>;

function classes(variant: Variant, extra?: string): string {
  const base = `btn btn-${variant}`;
  return extra ? `${base} ${extra}` : base;
}

export function Button({ variant = 'primary', withArrow, children, className, ...rest }: ButtonProps) {
  return (
    <button className={classes(variant, className)} {...rest}>
      {children}
      {withArrow && <span className="btn-arrow">→</span>}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  withArrow,
  children,
  className,
  href,
  ...rest
}: AnchorProps) {
  // next/link 不接受 onClick 之外的某些属性，这里用普通 <a> 包一层 Link
  return (
    <Link href={href} className={classes(variant, className)} {...rest}>
      {children}
      {withArrow && <span className="btn-arrow">→</span>}
    </Link>
  );
}
