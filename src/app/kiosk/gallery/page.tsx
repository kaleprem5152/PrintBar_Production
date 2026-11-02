import type { Metadata } from "next";
import Link from "next/link";
import { Scaled } from "@/components/kiosk/FitStage";
import { CompletedScreen, ErrorScreen, IdleScreen, PinScreen, PrintingScreen, RetrievedScreen } from "@/components/kiosk/screens";
import { SAMPLE_ORDER } from "@/components/kiosk/types";
import { Logo } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "Kiosk screens — PrintBar" };

const ORDER = SAMPLE_ORDER;

function Card({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <figure>
      <div className="overflow-hidden rounded-[14px] border-[6px] border-[#1a1c20] bg-white shadow-xl">
        <Scaled>{children}</Scaled>
      </div>
      <figcaption className="mt-3 flex items-baseline gap-3 text-sm">
        <span className="font-mono text-xs text-mute">{n}</span>
        <span className="font-medium">{title}</span>
      </figcaption>
    </figure>
  );
}

export default function Gallery() {
  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Link href="/">
            <Logo />
          </Link>
          <Link href="/kiosk" className="text-sm font-semibold hover:underline">
            Open live kiosk →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-10">
        <h1 className="text-4xl font-semibold tracking-tight">Kiosk screens</h1>
        <p className="mt-2 max-w-xl text-mute">Every state of the 10-inch (1280×800) landscape touchscreen, using the sample job PB-2026-00142.</p>
        <div className="mt-10 grid gap-x-8 gap-y-10 md:grid-cols-2">
          <Card n="01" title="Idle / Welcome">
            <IdleScreen url="https://printbar.example/print" />
          </Card>
          <Card n="02" title="PIN entry">
            <PinScreen digits="48" />
          </Card>
          <Card n="02b" title="PIN — invalid">
            <PinScreen digits="1234" state="invalid" attemptsLeft={2} />
          </Card>
          <Card n="02c" title="PIN — verified">
            <PinScreen digits="4827" state="ok" />
          </Card>
          <Card n="03" title="Retrieved job">
            <RetrievedScreen order={ORDER} />
          </Card>
          <Card n="04" title="Printing progress">
            <PrintingScreen order={ORDER} />
          </Card>
          <Card n="05" title="Completed">
            <CompletedScreen order={{ ...ORDER, pagesPrinted: 30, progress: 100, pagesRemaining: 0 }} secondsLeft={25} />
          </Card>
          <Card n="06a" title="Error — expired PIN">
            <ErrorScreen kind="expired_pin" />
          </Card>
          <Card n="06b" title="Error — too many invalid PINs">
            <ErrorScreen kind="invalid_pin" />
          </Card>
          <Card n="06c" title="Error — printer offline">
            <ErrorScreen kind="printer_offline" order={ORDER} />
          </Card>
          <Card n="06d" title="Error — paper out">
            <ErrorScreen kind="paper_out" order={ORDER} />
          </Card>
          <Card n="06e" title="Error — paper jam">
            <ErrorScreen kind="paper_jam" order={ORDER} />
          </Card>
          <Card n="06f" title="Error — network failure">
            <ErrorScreen kind="network" />
          </Card>
          <Card n="06g" title="Error — printing failed">
            <ErrorScreen kind="print_failed" order={ORDER} />
          </Card>
        </div>
      </main>
    </div>
  );
}
