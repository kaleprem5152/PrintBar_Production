"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, Logo } from "@/components/ui/Icon";
import { ALLOWED_EXT, rupees } from "@/lib/config";
import { calculatePrintQuote, parsePageRange } from "@/lib/pricing";
import { DocPreview } from "./DocPreview";
import { PaymentSheet } from "./PaymentSheet";
import { SettingsPanel } from "./Settings";
import { fmtSize, type Cfg, type Settings, type UDoc } from "./types";

const STEPS = ["Upload", "Preview", "Settings", "Summary", "Payment"];

export function Workspace({ cfg }: { cfg: Cfg }) {
  const router = useRouter();
  const [docs, setDocs] = useState<UDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    colorMode: "bw",
    copies: 1,
    paperSize: cfg.hardware.paperSizes[0] ?? "A4",
    sides: "single",
    orientation: "portrait",
    pagesPerSheet: 1,
  });
  const [order, setOrder] = useState<{ orderId: string; token: string; amount: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const xhrs = useRef<Record<string, XMLHttpRequest>>({});

  const ready = docs.filter((d) => d.status === "ready");
  const uploading = docs.some((d) => d.status === "uploading");
  const active = docs.find((d) => d.localId === activeId && d.status === "ready") ?? ready[0] ?? null;

  const patch = useCallback((id: string, p: Partial<UDoc>) => setDocs((ds) => ds.map((d) => (d.localId === id ? { ...d, ...p } : d))), []);

  /* ---------- Upload ---------- */
  const startUpload = useCallback(
    async (doc: UDoc) => {
      patch(doc.localId, { status: "uploading", progress: 0, error: undefined });
      const form = new FormData();
      form.append("file", doc.file);
      const xhr = new XMLHttpRequest();
      xhrs.current[doc.localId] = xhr;
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patch(doc.localId, { progress: Math.min(99, Math.round((e.loaded / e.total) * 100)) });
      };
      xhr.onload = () => {
        delete xhrs.current[doc.localId];
        let j: Record<string, unknown> = {};
        try {
          j = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status === 200) {
          patch(doc.localId, {
            status: "ready",
            progress: 100,
            serverId: j.id as string,
            name: j.name as string,
            pages: j.pages as number,
            estimated: !!j.estimated,
          });
          setActiveId((cur) => cur ?? doc.localId);
        } else {
          patch(doc.localId, { status: "error", error: (j.error as string) || "Upload failed. Please try again." });
        }
      };
      xhr.onerror = () => {
        delete xhrs.current[doc.localId];
        patch(doc.localId, { status: "error", error: "Network problem. Check your connection and retry." });
      };
      xhr.send(form);
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (cfg.paper?.maintenanceMode) {
        setNotice("Kiosk is currently undergoing maintenance. Document uploads are temporarily paused.");
        return;
      }
      if (cfg.paper?.outOfPaper || cfg.paper?.paperReady === false) {
        setNotice("Kiosk is out of paper. Please wait for an operator to refill paper before uploading.");
        return;
      }

      const arr = Array.from(files);
      let slots = cfg.hardware.maxFiles - docs.length;
      const created: UDoc[] = [];
      for (const file of arr) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        const base: UDoc = {
          localId: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          kind: ext === "jpeg" ? "jpg" : ext,
          status: "uploading",
          progress: 0,
          pages: 1,
          estimated: false,
          range: "",
          useRange: false,
        };
        let error = "";
        if (slots <= 0) error = `You can add up to ${cfg.hardware.maxFiles} files per order.`;
        else if (!(ALLOWED_EXT as readonly string[]).includes(ext)) error = "Unsupported file type. Use PDF, DOC, DOCX, JPG or PNG.";
        else if (file.size === 0) error = "This file is empty.";
        else if (file.size > cfg.hardware.maxUploadBytes) error = `File is ${fmtSize(file.size)} — the limit is 25 MB.`;
        if (error) created.push({ ...base, status: "error", error });
        else {
          slots--;
          created.push(base);
        }
      }
      setDocs((ds) => [...ds, ...created]);
      created.filter((d) => d.status === "uploading").forEach((d) => void startUpload(d));
    },
    [cfg.hardware.maxFiles, cfg.hardware.maxUploadBytes, docs.length, startUpload],
  );

  function removeDoc(d: UDoc) {
    xhrs.current[d.localId]?.abort();
    delete xhrs.current[d.localId];
    if (d.serverId) void fetch(`/api/upload/${d.serverId}`, { method: "DELETE" }).catch(() => {});
    setDocs((ds) => ds.filter((x) => x.localId !== d.localId));
    if (activeId === d.localId) {
      setActiveId(null);
      setPage(1);
    }
  }

  /* ---------- Authoritative Quote Calculation ---------- */
  const quote = useMemo(
    () =>
      calculatePrintQuote(
        ready.map((d) => ({
          name:  d.name,
          pages: d.pages,
          range: d.useRange ? d.range : null,
        })),
        {
          copies:        settings.copies,
          colorMode:     settings.colorMode,
          sides:         settings.sides,
          pagesPerSheet: settings.pagesPerSheet,
          config: {
            bwPerPage:      cfg.pricing.bw,
            colorPerPage:   cfg.pricing.color,
            billingBasis:   cfg.pricing.billingBasis,
            minOrderAmount: cfg.pricing.minOrderAmount,
          },
        }
      ),
    [ready, settings, cfg.pricing]
  );

  const lines = quote.lines;
  const pagesPerCopy = quote.pagesPerCopy;
  const totalPages = quote.totalLogicalPages;
  const physicalSheets = quote.physicalSheets;
  const rate = quote.rate;
  const amount = quote.amount;
  const hasRangeError = !!quote.error;
  const isMaintenance = Boolean(cfg.paper?.maintenanceMode);
  const isOutOfPaper = Boolean(cfg.paper?.outOfPaper || cfg.paper?.paperReady === false);
  const isBlocked = isMaintenance || isOutOfPaper;
  const blockedText = isMaintenance ? "Maintenance Mode" : isOutOfPaper ? "Out of Paper" : undefined;
  const canContinue = ready.length > 0 && !uploading && !hasRangeError && pagesPerCopy > 0 && !isBlocked;

  const signature = JSON.stringify([ready.map((d) => [d.serverId, d.useRange ? d.range : ""]), settings]);
  useEffect(() => setOrder(null), [signature]);

  async function proceed() {
    if (!canContinue || isBlocked) return;
    setNotice("");
    if (order) return setPayOpen(true);
    setCreating(true);
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docs: ready.map((d) => ({
            id: d.serverId,
            name: d.name,
            size: d.size,
            pages: d.pages,
            range: d.useRange && d.range.trim() ? d.range.trim() : null,
          })),
          ...settings,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not create your order.");
      if (j.amount !== amount) setNotice(`Total confirmed by PrintBar: ${rupees(j.amount)}.`);
      setOrder({ orderId: j.orderId, token: j.token, amount: j.amount });
      setPayOpen(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  const step = payOpen ? 4 : ready.length === 0 ? 0 : canContinue ? 3 : 2;

  return (
    <div className="min-h-svh bg-paper">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
          <Link href="/" aria-label="PrintBar home">
            <Logo />
          </Link>
          <ol className="flex items-center gap-1.5" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5" aria-current={i === step ? "step" : undefined}>
                <span className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-signal" : i < step ? "w-3 bg-ink" : "w-3 bg-line"}`} />
                <span className={`text-[12px] font-semibold ${i === step ? "" : "hidden text-mute xl:inline"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-36 pt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8 lg:px-8 lg:pb-16 lg:pt-10">
        <div className="space-y-5">
          {isBlocked && (
            <div
              className={`flex items-start gap-3.5 rounded-2xl border p-4.5 text-sm shadow-sm ${
                isMaintenance
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
                  : "border-red-300 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
              }`}
              role="alert"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm text-base">
                {isMaintenance ? "🛠️" : "⚠️"}
              </span>
              <div>
                <p className="font-semibold text-[15px]">
                  {isMaintenance ? "Kiosk in Maintenance Mode" : "Kiosk Out of Paper"}
                </p>
                <p className="mt-0.5 leading-relaxed opacity-90">
                  {isMaintenance
                    ? "Printing operations are temporarily suspended for servicing. Please check back shortly."
                    : "Uploads and payments are temporarily paused while an operator refills the paper trays."}
                </p>
              </div>
            </div>
          )}

          <div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              {ready.length ? "Review and print" : <>Upload your <span className="font-display italic font-normal">document.</span></>}
            </h1>
            {!ready.length && <p className="mt-2 text-[15px] text-mute">PDF, DOC, DOCX, JPG or PNG · up to 25 MB per file</p>}
          </div>

          {/* Upload */}
          <section aria-label="Upload documents">
            <input
              ref={input}
              type="file"
              multiple
              disabled={isBlocked}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {docs.length === 0 ? (
              <div
                onDragOver={(e) => {
                  if (isBlocked) return;
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  if (isBlocked) return;
                  e.preventDefault();
                  setDrag(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={`flex flex-col items-center rounded-[28px] border-2 border-dashed px-6 py-14 text-center transition ${
                  isBlocked
                    ? "border-amber-300/40 bg-amber-50/20 opacity-80"
                    : drag
                    ? "border-signal bg-signal-soft"
                    : "border-ink/20 bg-white"
                }`}
              >
                <span className={`flex h-16 w-16 items-center justify-center rounded-2xl ${isBlocked ? "bg-amber-100 text-amber-800" : "bg-ink text-paper"}`}>
                  <Icon name={isBlocked ? "alert" : "upload"} size={28} />
                </span>
                <p className="mt-5 text-xl font-semibold">
                  {isMaintenance ? "Kiosk in maintenance mode" : isOutOfPaper ? "Kiosk is out of paper" : drag ? "Drop to upload" : "Choose a file to print"}
                </p>
                <p className="mt-1 text-[15px] text-mute">
                  {isBlocked
                    ? "Uploads and printing are paused until serviced."
                    : "Drag and drop here, or browse your files (up to 25 MB)"}
                </p>
                <button
                  type="button"
                  disabled={isBlocked}
                  onClick={() => !isBlocked && input.current?.click()}
                  className={`mt-6 inline-flex h-14 items-center rounded-full px-8 text-[16px] font-semibold transition ${
                    isBlocked
                      ? "bg-line text-mute cursor-not-allowed"
                      : "bg-ink text-paper hover:bg-ink-2 active:scale-[0.98]"
                  }`}
                >
                  {isBlocked ? (isMaintenance ? "Maintenance Active" : "Paper Refill Required") : "Select files"}
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  if (isBlocked) return;
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  if (isBlocked) return;
                  e.preventDefault();
                  setDrag(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={`rounded-[24px] border bg-white p-2 transition ${drag ? "border-signal bg-signal-soft" : "border-line"}`}
              >
                <ul className="space-y-1">
                  {docs.map((d) => {
                    const on = active?.localId === d.localId;
                    return (
                      <li key={d.localId}>
                        <div
                          className={`flex items-center gap-3 rounded-2xl p-3 transition ${on ? "bg-paper-2" : ""} ${d.status === "ready" ? "cursor-pointer hover:bg-paper-2/70" : ""}`}
                          onClick={() => {
                            if (d.status === "ready") {
                              setActiveId(d.localId);
                              setPage(1);
                              setZoom(1);
                            }
                          }}
                        >
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                              d.status === "error" ? "bg-red-50 text-bad" : d.status === "ready" ? "bg-ok-soft text-ok" : "bg-paper-2 text-ink"
                            }`}
                          >
                            <Icon name={d.status === "error" ? "alert" : d.status === "ready" ? "check" : "file"} size={19} strokeWidth={d.status === "ready" ? 2.4 : 1.8} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14.5px] font-semibold">{d.name}</p>
                            {d.status === "uploading" && (
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100}>
                                  <div className="h-full rounded-full bg-signal transition-[width] duration-200" style={{ width: `${d.progress}%` }} />
                                </div>
                                <span className="w-9 text-right text-[12px] font-medium tabular-nums text-mute">{d.progress}%</span>
                              </div>
                            )}
                            {d.status === "ready" && (
                              <p className="text-[12.5px] text-mute">
                                {fmtSize(d.size)} · {d.estimated ? "~" : ""}
                                {d.pages} page{d.pages === 1 ? "" : "s"} · Uploaded
                              </p>
                            )}
                            {d.status === "error" && <p className="text-[12.5px] text-bad">{d.error}</p>}
                          </div>
                          {d.status === "error" && d.size > 0 && d.size <= cfg.hardware.maxUploadBytes && !d.error?.includes("Unsupported") && !d.error?.includes("up to") && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void startUpload(d);
                              }}
                              className="rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold hover:bg-white"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove ${d.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeDoc(d);
                            }}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mute transition hover:bg-white hover:text-bad"
                          >
                            <Icon name="x" size={17} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {docs.length < cfg.hardware.maxFiles && (
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/20 text-[14.5px] font-semibold text-ink/80 transition hover:bg-paper-2"
                  >
                    <Icon name="plus" size={17} /> Upload another file
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Preview then settings, directly below */}
          {active && (
            <>
              <DocPreview doc={active} page={page} setPage={setPage} zoom={zoom} setZoom={setZoom} onRemove={() => removeDoc(active)} />
              <SettingsPanel
                cfg={cfg}
                settings={settings}
                setSettings={setSettings}
                doc={active}
                updateDoc={(p) => patch(active.localId, p)}
                multi={ready.length > 1}
              />
            </>
          )}
        </div>

        {/* Summary */}
        <aside className="mt-5 lg:sticky lg:top-24 lg:mt-0" aria-label="Price summary">
          <div className="overflow-hidden rounded-[24px] border border-line bg-white">
            <div className="p-5 md:p-6">
              <h2 className="text-xl font-semibold tracking-tight">Order summary</h2>
              {ready.length === 0 ? (
                <p className="mt-3 text-[14.5px] text-mute">Add a document to see your price. Pricing is {rupees(cfg.pricing.bw)}/page black &amp; white and {rupees(cfg.pricing.color)}/page colour.</p>
              ) : (
                <dl className="mt-4 space-y-3 text-[14.5px]">
                  <div>
                    <dt className="text-[12.5px] font-semibold uppercase tracking-wider text-mute">Documents · {ready.length}</dt>
                    <dd className="mt-1.5 space-y-1">
                      {lines.map((l) => (
                        <div key={l.name} className="flex justify-between gap-3">
                          <span className="truncate">{l.name}</span>
                          <span className="shrink-0 tabular-nums text-mute">{l.selectedPages} pg</span>
                        </div>
                      ))}
                    </dd>
                  </div>
                  <Row k="Total pages" v={`${pagesPerCopy}${settings.copies > 1 ? ` × ${settings.copies} = ${totalPages}` : ""}`} />
                  <Row k="Pages per sheet" v={settings.pagesPerSheet === 1 ? "1-up (Standard)" : `${settings.pagesPerSheet}-up (${settings.pagesPerSheet} on 1)`} />
                  <Row k="Printing sides" v={settings.sides === "single" ? "Single-sided" : "Double-sided"} />
                  <Row k="Physical sheets" v={`${physicalSheets} sheet${physicalSheets === 1 ? "" : "s"}`} />
                  <Row k="Colour mode" v={settings.colorMode === "bw" ? "Black & White" : "Colour"} />
                  <Row k="Settings" v={`${settings.paperSize} · ${settings.orientation === "portrait" ? "Portrait" : "Landscape"}`} />
                </dl>
              )}
            </div>
            {ready.length > 0 && (
              <>
                <div className="border-t border-dashed border-line bg-paper-2/50 px-5 py-4 md:px-6">
                  <div className="flex items-center justify-between text-[14px] text-mute">
                    <span>
                      {physicalSheets} sheet{physicalSheets === 1 ? "" : "s"} × {rupees(rate)}
                    </span>
                    <span className="tabular-nums">{rupees(amount)}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <span className="text-[14px] font-semibold">Total payable</span>
                    <span key={amount} className="animate-pop text-4xl font-semibold tabular-nums tracking-tight">
                      {rupees(amount)}
                    </span>
                  </div>
                </div>
                <div className="hidden p-5 pt-4 lg:block md:p-6 md:pt-4">
                  <PayButton onClick={proceed} disabled={!canContinue || creating || isBlocked} loading={creating} uploading={uploading} blockedText={blockedText} />
                  {notice && <p className="mt-3 text-center text-[13px] text-bad" role="alert">{notice}</p>}
                </div>
              </>
            )}
          </div>
          <p className="mt-4 flex items-start gap-2 px-1 text-[13px] leading-relaxed text-mute">
            <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
            Your files are deleted from PrintBar storage after successful printing.
          </p>
        </aside>
      </main>

      {/* Mobile sticky bar */}
      {ready.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl lg:hidden">
          {notice && <p className="mb-2 text-center text-[12.5px] text-bad" role="alert">{notice}</p>}
          <div className="mx-auto flex max-w-lg items-center gap-4">
            <div className="shrink-0">
              <p className="text-[12px] text-mute">Total payable</p>
              <p className="text-2xl font-semibold tabular-nums leading-tight">{rupees(amount)}</p>
            </div>
            <PayButton onClick={proceed} disabled={!canContinue || creating || isBlocked} loading={creating} uploading={uploading} compact blockedText={blockedText} />
          </div>
        </div>
      )}

      {payOpen && order && (
        <PaymentSheet
          order={order}
          onClose={() => setPayOpen(false)}
          onPaid={() => router.push(`/track/${order.orderId}?k=${order.token}&new=1`)}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-mute">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function PayButton({
  onClick,
  disabled,
  loading,
  uploading,
  compact,
  blockedText,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  uploading: boolean;
  compact?: boolean;
  blockedText?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-paper transition enabled:hover:bg-ink-2 enabled:active:scale-[0.99] disabled:opacity-40 ${compact ? "flex-1" : "w-full"}`}
    >
      {loading ? (
        <span className="h-5 w-5 animate-spin-slow rounded-full border-2 border-paper/30 border-t-paper" />
      ) : blockedText ? (
        <span>{blockedText}</span>
      ) : (
        <>
          {uploading ? "Uploading…" : "Continue to Payment"}
          {!uploading && <Icon name="arrow" size={18} />}
        </>
      )}
    </button>
  );
}
