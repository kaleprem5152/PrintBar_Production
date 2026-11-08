"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { expandRange } from "@/lib/pricing";
import { fmtSize, type UDoc } from "./types";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type LoadingTask = { promise: Promise<unknown>; destroy?: () => unknown };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function DocPreview({
  doc,
  page,
  setPage,
  zoom,
  setZoom,
  onRemove,
}: {
  doc: UDoc;
  page: number;
  setPage: (n: number) => void;
  zoom: number;
  setZoom: (z: number) => void;
  onRemove: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(320);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState<string>("");
  const [imgUrl, setImgUrl] = useState<string>("");

  const total = pdf ? pdf.numPages : doc.pages;
  const selected = doc.useRange ? expandRange(doc.range, doc.pages) : null;
  const pagePrinted = !selected || selected.has(page);
  const navigable = doc.kind === "pdf";

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // Load the document for preview
  useEffect(() => {
    let cancelled = false;
    let task: LoadingTask | null = null;
    let url = "";
    setState("loading");
    setPdf(null);
    setText("");
    setImgUrl("");
    (async () => {
      try {
        if (doc.kind === "pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          const data = new Uint8Array(await doc.file.arrayBuffer());
          task = pdfjs.getDocument({ data }) as unknown as LoadingTask;
          const loaded = (await task.promise) as PdfDoc;
          if (cancelled) return;
          setPdf(loaded);
          setState("ready");
        } else if (doc.kind === "jpg" || doc.kind === "png") {
          url = URL.createObjectURL(doc.file);
          setImgUrl(url);
          setState("ready");
        } else if (doc.kind === "docx") {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(doc.file);
          const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
          const paras = xml
            .split("</w:p>")
            .map((p) => decode(p.replace(/<w:tab\/>/g, "    ").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")).trim())
            .filter(Boolean);
          if (!cancelled) {
            setText(paras.join("\n\n").slice(0, 3200));
            setState("ready");
          }
        } else {
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      try {
        void task?.destroy?.();
      } catch {
        /* ignore */
      }
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.localId, doc.file, doc.kind]);

  // Render the current PDF page
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let dead = false;
    (async () => {
      const pg = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
      if (dead || !canvasRef.current) return;
      const base = pg.getViewport({ scale: 1 });
      const fit = Math.max(120, width - 32) / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: fit * zoom * dpr });
      const c = canvasRef.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`;
      c.style.height = `${Math.floor(vp.height / dpr)}px`;
      task = pg.render({ canvas: c, viewport: vp });
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [pdf, page, zoom, width]);

  const zi = ZOOMS.indexOf(zoom);
  const stepZoom = (d: number) => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (zi < 0 ? 2 : zi) + d))]);

  return (
    <section className="overflow-hidden rounded-[24px] border border-line bg-white" aria-label="Document preview">
      <div className="flex items-start justify-between gap-3 p-4 md:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paper-2">
            <Icon name={doc.kind === "jpg" || doc.kind === "png" ? "image" : "file"} size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15.5px] font-semibold">{doc.name}</p>
            <p className="text-[13px] text-mute">
              {fmtSize(doc.size)} · {doc.estimated ? "~" : ""}
              {doc.pages} page{doc.pages === 1 ? "" : "s"}
              {doc.estimated && " (estimated)"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-mute transition hover:border-bad/40 hover:text-bad"
        >
          <Icon name="trash" size={15} /> Remove
        </button>
      </div>

      <div ref={box} className="relative h-[340px] sm:h-[440px] md:h-[560px] overflow-auto border-y border-line bg-[#e9e5db]">
        <div className="flex min-h-full min-w-full items-start justify-center p-4" style={{ width: "max-content" }}>
          {state === "loading" && (
            <div className="mt-24 flex flex-col items-center gap-3 text-mute">
              <span className="h-7 w-7 animate-spin-slow rounded-full border-2 border-mute/30 border-t-ink" />
              <span className="text-sm">Preparing preview…</span>
            </div>
          )}
          {state === "error" && (
            <div className="mt-20 max-w-[260px] text-center text-sm text-mute">
              <Icon name="alert" size={26} className="mx-auto mb-2 text-warn" />
              We couldn&apos;t render a preview, but the file can still be printed.
            </div>
          )}
          {state === "ready" && doc.kind === "pdf" && (
            <div className="relative">
              <canvas ref={canvasRef} className="rounded-sm bg-white shadow-[0_8px_30px_rgba(0,0,0,0.18)]" />
              {!pagePrinted && (
                <span className="absolute left-3 top-3 rounded-full bg-ink/85 px-3 py-1 text-xs font-semibold text-white">Not in print range</span>
              )}
            </div>
          )}
          {state === "ready" && imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={doc.name} className="rounded-sm bg-white shadow-[0_8px_30px_rgba(0,0,0,0.18)]" style={{ width: Math.max(120, width - 32) * zoom }} />
          )}
          {state === "ready" && doc.kind === "docx" && (
            <div className="bg-white p-8 shadow-[0_8px_30px_rgba(0,0,0,0.18)]" style={{ width: Math.max(220, width - 32) * zoom, fontSize: 12 * zoom }}>
              {text ? (
                <p className="whitespace-pre-wrap font-serif leading-relaxed text-ink/90">{text}</p>
              ) : (
                <p className="text-mute">No text content found in this document.</p>
              )}
              <p className="mt-6 border-t border-line pt-3 text-[0.85em] text-mute">
                Text preview — fonts and layout may differ when printed.
              </p>
            </div>
          )}
          {state === "ready" && doc.kind === "doc" && (
            <div className="mt-16 max-w-[280px] rounded-2xl bg-white p-6 text-center shadow-sm">
              <Icon name="file" size={32} className="mx-auto text-mute" />
              <p className="mt-3 font-semibold">Preview not available for .doc files</p>
              <p className="mt-1 text-sm text-mute">The page count is estimated. For an exact preview, save the file as PDF or DOCX.</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 p-3 md:px-5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={!navigable || page <= 1}
            onClick={() => setPage(page - 1)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line transition enabled:hover:bg-paper-2 disabled:opacity-35"
          >
            <Icon name="chevL" size={18} />
          </button>
          <span className="min-w-[88px] text-center text-[14px] font-medium tabular-nums">
            {navigable ? `Page ${Math.min(page, total)} / ${total}` : `${doc.pages} page${doc.pages === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={!navigable || page >= total}
            onClick={() => setPage(page + 1)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line transition enabled:hover:bg-paper-2 disabled:opacity-35"
          >
            <Icon name="chevR" size={18} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => stepZoom(-1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line transition enabled:hover:bg-paper-2 disabled:opacity-35">
            <Icon name="zoomOut" size={18} />
          </button>
          <button type="button" onClick={() => setZoom(1)} className="min-w-[58px] text-center text-[13px] font-medium tabular-nums text-mute" aria-label="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line transition enabled:hover:bg-paper-2 disabled:opacity-35">
            <Icon name="zoomIn" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
