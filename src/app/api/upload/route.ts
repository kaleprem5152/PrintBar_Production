import { randomUUID } from "crypto";
import { ALLOWED_EXT, DEVICE_ID, HARDWARE } from "@/lib/config";
import { countDocxPages, countPdfPages, storeFile, sweepOldFiles } from "@/lib/server/files";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string[]> = {
  pdf: [
    "application/pdf",
    "application/x-pdf",
    "application/acrobat",
    "applications/vnd.pdf",
    "text/pdf",
    "application/octet-stream",
  ],
  doc: [
    "application/msword",
    "application/doc",
    "application/x-msword",
    "application/octet-stream",
  ],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
  jpg: ["image/jpeg", "image/pjpeg", "image/jpg", "application/octet-stream"],
  jpeg: ["image/jpeg", "image/pjpeg", "image/jpg", "application/octet-stream"],
  png: ["image/png", "image/x-png", "application/octet-stream"],
};

export async function POST(req: Request) {
  // Check kiosk hardware and paper availability before accepting file
  try {
    const [dev] = await db.select().from(devices).where(eq(devices.id, DEVICE_ID)).limit(1);
    if (dev) {
      if (dev.maintenanceMode) {
        return Response.json(
          { error: "The PrintBar kiosk is currently in maintenance mode. Document uploads are temporarily paused." },
          { status: 503 }
        );
      }
      const totalPaper = (dev.kyoceraPaper ?? 0) + (dev.canonPaper ?? 0);
      if (!dev.paperReady || totalPaper <= 0) {
        return Response.json(
          { error: "The kiosk is currently out of paper. Document uploads are paused until an operator refills the paper." },
          { status: 503 }
        );
      }
    }
  } catch (err) {
    // If DB check fails, continue
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Upload could not be read. Please try again." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
    return Response.json({ error: "Unsupported file type. Use PDF, DOC, DOCX, JPG or PNG." }, { status: 415 });
  }
  if (file.size === 0) return Response.json({ error: "This file is empty." }, { status: 400 });
  if (file.size > HARDWARE.maxUploadBytes) {
    return Response.json({ error: "File is larger than 25 MB." }, { status: 413 });
  }
  if (file.type && MIME[ext] && !MIME[ext].includes(file.type)) {
    const isImage = (ext === "jpg" || ext === "jpeg" || ext === "png") && file.type.startsWith("image/");
    if (!isImage && file.type !== "application/octet-stream") {
      return Response.json({ error: "File content does not match its extension." }, { status: 415 });
    }
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let pages = 1;
  let estimated = false;

  if (ext === "pdf") {
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return Response.json({ error: "This does not look like a valid PDF." }, { status: 415 });
    }
    pages = countPdfPages(buf);
    if (!pages) {
      const hint = parseInt(String(form.get("pagesHint") ?? ""), 10);
      pages = hint > 0 && hint < 5000 ? hint : 1;
    }
  } else if (ext === "docx") {
    pages = await countDocxPages(buf);
    if (!pages) {
      pages = Math.max(1, Math.round(file.size / 28000));
      estimated = true;
    }
  } else if (ext === "doc") {
    pages = Math.max(1, Math.round(file.size / 28000));
    estimated = true;
  }

  const id = randomUUID();
  const meta = {
    name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120),
    size: file.size,
    pages,
    estimated,
    kind: ext === "jpeg" ? "jpg" : ext,
  };
  await storeFile(id, ext, buf, meta);
  void sweepOldFiles();

  return Response.json({ id, ...meta });
}
