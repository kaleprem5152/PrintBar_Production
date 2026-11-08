import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PRICING } from "@/lib/config";

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
      <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-signal">Simple pricing</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Two ways to print. <span className="font-display italic font-normal">One price per page.</span>
          </h2>
        </div>
        <p className="max-w-sm text-[15px] text-mute">The total is calculated at checkout from the pages you select.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="relative overflow-hidden rounded-[28px] bg-ink p-7 text-paper md:p-9">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-paper/60">Black &amp; White</h3>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-[64px] sm:text-[88px] md:text-[112px] font-semibold leading-none tracking-tighter">₹{PRICING.bw}</span>
                <span className="text-lg text-paper/60">per page</span>
              </p>
            </div>
            <SheetStack mono />
          </div>
          <p className="mt-8 max-w-xs text-[15px] text-paper/70">Notes, assignments, forms and reading material. Crisp text at the lowest price.</p>
        </article>

        <article className="relative overflow-hidden rounded-[28px] border border-line bg-white p-7 md:p-9">
          <div className="cmy-gradient absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-mute">Colour</h3>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-[64px] sm:text-[88px] md:text-[112px] font-semibold leading-none tracking-tighter">₹{PRICING.color}</span>
                <span className="text-lg text-mute">per page</span>
              </p>
            </div>
            <SheetStack />
          </div>
          <p className="relative mt-8 max-w-xs text-[15px] text-mute">Presentations, posters, photos and diagrams in full colour.</p>
        </article>
      </div>
    </section>
  );
}

function SheetStack({ mono = false }: { mono?: boolean }) {
  return (
    <div className="relative hidden h-28 w-24 sm:block" aria-hidden="true">
      {[2, 1, 0].map((i) => (
        <div
          key={i}
          className="absolute h-24 w-[72px] rounded-md border shadow-sm"
          style={{
            left: i * 8,
            top: i * 6,
            background: mono ? "#23262d" : "#fff",
            borderColor: mono ? "#3a3e47" : "#e7e2d6",
            transform: `rotate(${(i - 1) * 4}deg)`,
          }}
        >
          {i === 0 && (
            <div className="space-y-1.5 p-2.5">
              <div className={`h-1.5 w-8 rounded ${mono ? "bg-paper/70" : "cmy-gradient"}`} />
              <div className={`h-1 rounded ${mono ? "bg-paper/25" : "bg-ink/15"}`} />
              <div className={`h-1 rounded ${mono ? "bg-paper/25" : "bg-ink/15"}`} />
              <div className={`h-6 rounded ${mono ? "bg-paper/15" : "cmy-gradient opacity-70"}`} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: "trash", title: "Automatic deletion", text: "Your file is removed from PrintBar storage after successful printing." },
  { icon: "database", title: "No permanent storage", text: "Uploads are temporary. We don't keep document files for future use." },
  { icon: "lock", title: "Secure handling", text: "Jobs are released only with your one-time collection PIN." },
  { icon: "shield", title: "Privacy-first printing", text: "Print at your own pace, without leaving files on a shared computer." },
];

export function PrivacySection() {
  const nodes = [
    { left: "12%", icon: "phone" as IconName, label: "Upload" },
    { left: "38%", icon: "database" as IconName, label: "Temporary storage" },
    { left: "64%", icon: "keypad" as IconName, label: "PIN at kiosk" },
    { left: "88%", icon: "file" as IconName, label: "Printed" },
  ];
  return (
    <section id="privacy" className="relative overflow-hidden bg-ink text-paper">
      <div className="pointer-events-none absolute -left-40 top-0 h-[480px] w-[480px] rounded-full bg-signal/20 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-signal">Privacy</p>
        <h2 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          Your documents. Your privacy.{" "}
          <span className="font-display italic font-normal text-paper/70">Nothing left behind.</span>
        </h2>
        <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-paper/70">
          Your uploaded documents are automatically deleted from PrintBar storage after successful printing. We don&apos;t retain your document files for future use.
        </p>

        {/* Animated lifecycle */}
        <div className="mt-12 rounded-[28px] border border-paper/10 bg-paper/[0.04] p-5 md:p-8" role="img" aria-label="A document travels from upload to temporary storage to the kiosk, then is deleted from storage after printing">
          <div className="relative h-36 md:h-44">
            <div className="absolute left-[12%] right-[12%] top-[38%] h-px bg-gradient-to-r from-paper/10 via-paper/30 to-paper/10" />
            {nodes.map((n, i) => (
              <div key={n.label} className="absolute top-[38%] -translate-x-1/2 -translate-y-1/2" style={{ left: n.left }}>
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-paper/15 bg-ink text-paper/80 md:h-16 md:w-16">
                  <Icon name={n.icon} size={24} />
                  {i === 1 && (
                    <>
                      <span className="animate-flow-ring absolute inset-0 rounded-2xl border border-signal" />
                    </>
                  )}
                </div>
                <p className="absolute left-1/2 top-[68px] w-24 -translate-x-1/2 text-center text-[11.5px] font-medium leading-tight text-paper/60 md:top-[76px] md:w-28 md:text-[13px]">
                  {n.label}
                </p>
              </div>
            ))}
            {/* travelling document */}
            <div className="animate-flow-doc absolute top-[38%] z-10 h-9 w-7 -translate-x-1/2 rounded-[5px] bg-paper shadow-lg md:h-10 md:w-8">
              <div className="space-y-1 p-1.5">
                <div className="h-[3px] w-3 rounded bg-ink/70" />
                <div className="h-[2px] rounded bg-ink/30" />
                <div className="h-[2px] rounded bg-ink/30" />
                <div className="h-[2px] w-4 rounded bg-ink/30" />
              </div>
            </div>
            {/* deleted label under storage */}
            <div className="animate-flow-label absolute left-[38%] top-[8%] -translate-x-1/2 rounded-full bg-signal px-3 py-1 text-[11px] font-semibold text-white md:text-xs">
              Deleted
            </div>
            <div className="animate-flow-printed absolute left-[88%] top-[8%] -translate-x-1/2 rounded-full bg-ok px-3 py-1 text-[11px] font-semibold text-white md:text-xs">
              Collected
            </div>
          </div>
        </div>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map((p) => (
            <li key={p.title} className="rounded-2xl border border-paper/10 bg-paper/[0.04] p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper/10 text-signal">
                <Icon name={p.icon} size={20} />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-paper/60">{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "upload", title: "Upload your document", text: "PDF, Word or image files up to 25 MB from your phone or laptop." },
  { icon: "eye", title: "Preview and choose settings", text: "Check every page, then pick colour, copies and pages to print." },
  { icon: "card", title: "Pay online, get your PIN", text: "Pay with UPI, card or net banking and receive a 4-digit PIN." },
  { icon: "keypad", title: "Enter your PIN at a kiosk", text: "Type your PIN on the kiosk screen and collect your prints." },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-signal">How it works</p>
      <h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
        From phone to printed page in <span className="font-display italic font-normal">four steps.</span>
      </h2>
      <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative rounded-[24px] border border-line bg-white p-6">
            <div className="flex items-center justify-between">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper-2 text-ink">
                <Icon name={s.icon} size={22} />
              </span>
              <span className="font-display text-5xl italic leading-none text-ink/15">0{i + 1}</span>
            </div>
            <h3 className="mt-6 text-[18px] font-semibold leading-snug">{s.title}</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-mute">{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <Link href="/print" className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-[15px] font-semibold text-paper transition hover:bg-ink-2">
          Start Printing <Icon name="arrow" size={18} />
        </Link>
      </div>
    </section>
  );
}

const FAQ = [
  { q: "Which files can I print?", a: "PDF, DOC, DOCX, JPG and PNG, up to 25 MB per file. Kiosks print on A4 paper, single- or double-sided." },
  { q: "What is the collection PIN?", a: "A 4-digit code shown after payment. Enter it on the kiosk to release your job. It is a collection code, not a login, and it expires after 24 hours." },
  { q: "Is my document stored?", a: "Your file is held temporarily so the kiosk can print it, and it is deleted from PrintBar storage after successful printing. Files you remove before paying are deleted immediately." },
  { q: "What happens if the printer stops?", a: "The kiosk tells you what happened, for example paper out or a jam. Your job is kept, and printing resumes from the page where it stopped once the kiosk is ready." },
  { q: "How is the price calculated?", a: `Pages × copies × ₹${PRICING.bw} for black & white or ₹${PRICING.color} for colour. The total is shown before you pay.` },
];

export function Faq() {
  return (
    <section id="help" className="mx-auto max-w-4xl px-5 py-20 lg:px-8 lg:py-28">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-signal">Help</p>
      <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
        Quick <span className="font-display italic font-normal">answers.</span>
      </h2>
      <div className="mt-10 divide-y divide-line border-y border-line">
        {FAQ.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
              {f.q}
              <Icon name="chevD" size={20} className="shrink-0 text-mute transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mute">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-2/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-[14px] text-mute md:flex-row md:items-center md:justify-between lg:px-8">
        <p>© 2026 PrintBar. Self-service printing for campuses and public spaces.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/demo" className="hover:text-ink">Prototype demo</Link>
          <Link href="/kiosk" className="hover:text-ink">Kiosk interface</Link>
          <Link href="/kiosk/gallery" className="hover:text-ink">Kiosk screens</Link>
        </div>
      </div>
    </footer>
  );
}
