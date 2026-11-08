import Link from "next/link";
import { HeroScene } from "@/components/site/HeroScene";
import { KioskFinder } from "@/components/site/KioskFinder";
import { Faq, HowItWorks, PricingSection, PrivacySection, SiteFooter } from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Icon } from "@/components/ui/Icon";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* HERO */}
        <section className="hero-glow relative overflow-hidden">
          <div className="mx-auto grid max-w-7xl items-center gap-0 px-5 pb-6 pt-8 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1fr_1.05fr] lg:gap-6 lg:px-8 lg:pb-10 lg:pt-4">
            <div className="relative z-10 animate-fade-up">
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-3.5 py-1.5 text-[13px] font-medium text-ink/70 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Self-service printing kiosks
              </p>
              <h1 className="mt-5 text-[34px] sm:text-5xl lg:text-[66px] font-semibold leading-[1.05] tracking-tight">
                Your documents. Printed.{" "}
                <span className="block font-display italic font-normal text-signal">Without the wait.</span>
              </h1>
              <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink/70 lg:text-[19px]">
                Upload online, pay securely and collect your prints from a nearby PrintBar kiosk.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/print"
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-ink px-8 text-[16px] font-semibold text-paper shadow-[0_12px_30px_-10px_rgba(16,18,22,0.6)] transition hover:bg-ink-2 active:scale-[0.98]"
                >
                  Start Printing <Icon name="arrow" size={18} />
                </Link>
                <Link
                  href="/#how"
                  className="inline-flex h-14 items-center justify-center rounded-full border border-ink/15 bg-white/60 px-8 text-[16px] font-semibold backdrop-blur transition hover:bg-white"
                >
                  How It Works
                </Link>
              </div>
              <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-mute">
                <span>
                  <b className="font-semibold text-ink">₹2</b>{" "}black &amp; white
                </span>
                <span className="h-3 w-px bg-line" />
                <span>
                  <b className="font-semibold text-ink">₹8</b>{" "}colour
                </span>
                <span className="h-3 w-px bg-line" />
                <span>per page</span>
              </p>
            </div>

            <div className="relative -mx-5 mt-2 h-[380px] sm:h-[520px] lg:mx-0 lg:mt-0 lg:h-[min(820px,calc(100svh-5rem))]">
              <HeroScene />
            </div>
          </div>
        </section>

        <PricingSection />
        <PrivacySection />
        <HowItWorks />
        <KioskFinder />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
