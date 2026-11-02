"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, Logo } from "@/components/ui/Icon";

const LINKS = [
  { href: "/#how", label: "How It Works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#kiosks", label: "Find a Kiosk" },
  { href: "/#help", label: "Help" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-colors ${
        scrolled || open ? "border-b border-line/70 bg-paper/85 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" aria-label="PrintBar home" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-[14.5px] font-medium text-ink/75 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/print"
            className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-paper transition hover:bg-ink-2 active:scale-[0.98]"
          >
            Start Printing
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/60 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "x" : "menu"} size={18} />
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line/70 bg-paper px-5 pb-5 pt-2 md:hidden" aria-label="Mobile">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between border-b border-line/60 py-4 text-[17px] font-medium"
            >
              {l.label}
              <Icon name="chevR" size={16} className="text-mute" />
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
