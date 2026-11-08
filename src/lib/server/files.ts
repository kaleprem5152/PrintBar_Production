import "server-only";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import JSZip from "jszip";

// Uploaded documents live only in temporary storage and are removed after a
// successful print (or when the customer removes them).
const DIR = process.env.TEMP_STORAGE_PATH || path.join(os.tmpdir(), "printbar-uploads");
const UUID = /^[0-9a-f-]{36}$/i;

export type FileMeta = { name: string; size: number; pages: number; estimated: boolean; kind: string };

export async function storeFile(id: string, ext: string, data: Buffer, meta: FileMeta) {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, `${id}.${ext}`), data);
  await writeFile(path.join(DIR, `${id}.meta`), JSON.stringify(meta));
}

/** Retrieve the stored file buffer and metadata */
export async function getStoredFile(id: string): Promise<{ buffer: Buffer; meta: FileMeta; ext: string } | null> {
  if (!UUID.test(id)) return null;
  const meta = await readMeta(id);
  if (!meta) return null;

  try {
    const files = await readdir(DIR);
    const filename = files.find((f) => f.startsWith(id + ".") && !f.endsWith(".meta"));
    if (!filename) return null;
    const buffer = await readFile(path.join(DIR, filename));
    const ext = filename.split(".").pop()?.toLowerCase() ?? meta.kind;
    return { buffer, meta, ext };
  } catch {
    return null;
  }
}

/** Server-side record of an upload. Page counts used for billing always come from here. */
export async function readMeta(id: string): Promise<FileMeta | null> {
  if (!UUID.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(DIR, `${id}.meta`), "utf8")) as FileMeta;
  } catch {
    return null;
  }
}

export async function deleteStoredFiles(ids: string[]): Promise<boolean> {
  let allDeleted = true;
  try {
    const files = await readdir(DIR);
    for (const id of ids) {
      if (!UUID.test(id)) continue;
      for (const f of files.filter((f) => f.startsWith(id + "."))) {
        try {
          await unlink(path.join(DIR, f));
        } catch {
          allDeleted = false;
        }
      }
    }
  } catch {
    /* directory may not exist yet */
  }
  return allDeleted;
}

export async function storedFileExists(id: string) {
  if (!UUID.test(id)) return false;
  try {
    const files = await readdir(DIR);
    const f = files.find((f) => f.startsWith(id + "."));
    if (!f) return false;
    await stat(path.join(DIR, f));
    return true;
  } catch {
    return false;
  }
}

/**
 * Verified cleanup of all documents associated with an order.
 * Updates order record with cleanupStatus ('CLEANED' or 'CLEANUP_FAILED') and timestamp.
 */
export async function cleanupOrderFiles(orderId: string): Promise<{ success: boolean; error?: string }> {
  const { db } = await import("@/db");
  const { orders } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  try {
    const [order] = await db.select().from(orders).where(eq(orders.orderId, orderId));
    if (!order) return { success: false, error: "Order not found" };

    const docs = (order.docs as { id: string }[]) || [];
    const docIds = docs.map((d) => d.id).filter(Boolean);

    if (docIds.length === 0) {
      await db
        .update(orders)
        .set({ filesDeleted: true, filesDeletedAt: new Date(), cleanupStatus: "CLEANED", updatedAt: new Date() })
        .where(eq(orders.orderId, orderId));
      return { success: true };
    }

    await deleteStoredFiles(docIds);

    // Verify deletion
    const remaining = [];
    for (const id of docIds) {
      if (await storedFileExists(id)) remaining.push(id);
    }

    if (remaining.length > 0) {
      await db
        .update(orders)
        .set({
          cleanupStatus: "CLEANUP_FAILED",
          cleanupError: `Files still exist after unlink: ${remaining.join(", ")}`,
          updatedAt: new Date(),
        })
        .where(eq(orders.orderId, orderId));
      return { success: false, error: "Files could not be completely removed." };
    }

    await db
      .update(orders)
      .set({
        filesDeleted: true,
        filesDeletedAt: new Date(),
        cleanupStatus: "CLEANED",
        cleanupError: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.orderId, orderId));

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Sweep leftovers older than 24h (best effort). */
export async function sweepOldFiles(): Promise<{ swept: number }> {
  let count = 0;
  try {
    const files = await readdir(DIR);
    for (const f of files) {
      const p = path.join(DIR, f);
      const s = await stat(p);
      if (Date.now() - s.mtimeMs > 24 * 3600 * 1000) {
        await unlink(p).catch(() => {});
        count++;
      }
    }
  } catch {
    /* ignore */
  }
  return { swept: count };
}

export function countPdfPages(buf: Buffer): number {
  const text = buf.toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10));
  const counts2 = [...text.matchAll(/\/Count\s+(\d+)[\s\S]{0,200}?\/Type\s*\/Pages/g)].map((m) => parseInt(m[1], 10));
  const best = Math.max(0, ...counts, ...counts2);
  if (best > 0) return best;
  return [...text.matchAll(/\/Type\s*\/Page(?![s\w])/g)].length;
}

export async function countDocxPages(buf: Buffer): Promise<number> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("docProps/app.xml")?.async("string");
    const m = xml?.match(/<Pages>(\d+)<\/Pages>/);
    return m ? Math.max(1, parseInt(m[1], 10)) : 0;
  } catch {
    return 0;
  }
}
