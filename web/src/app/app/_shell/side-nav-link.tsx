"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar link with active styling. Renders an icon + label in document
// order so callers pass them as children: `<SideNavLink>...icon...label</SideNavLink>`.
export function SideNavLink({
  href,
  exact,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <style>{`
        .sn-link {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: 8px;
          color: var(--color-muted-ash); font-size: 14px; font-weight: 500;
          text-decoration: none;
        }
        .sn-link:hover { background: var(--color-light-taupe); color: var(--color-midnight-ink); }
        .sn-link.is-active {
          background: var(--color-canvas-white);
          color: var(--color-midnight-ink);
          box-shadow: var(--shadow-subtle);
        }
      `}</style>
      <Link href={href} className={`sn-link ${active ? "is-active" : ""}`}>
        {children}
      </Link>
    </>
  );
}
