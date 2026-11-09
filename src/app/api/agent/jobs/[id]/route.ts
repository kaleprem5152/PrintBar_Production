import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { jobLogs, printAttempts, printers, printJobs } from "@/db/schema";
import { agentAuth } from "@/lib/agent";

export const dynamic = "force-dynamic";

/**
 * Agent reports print-attempt progress: { attemptNo, status: printing|succeeded|failed|partial, pagesPrinted, error?, cupsJobId? }
 * Closes the loop for dashboard-queued retries. A terminal attempt can never be re-opened (no duplicate print).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await agentAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { attemptNo?: number; status?: string; pagesPrinted?: number; error?: string; cupsJobId?: string };
  if (!["printing", "succeeded", "failed", "partial"].includes(b.status ?? "") || !Number.isInteger(b.attemptNo)) {
    return Response.json({ error: "attemptNo and valid status required" }, { status: 400 });
  }
  const res = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, id)).for("update");
    if (!job) return { code: 404, body: { error: "Job not found" } };
    const [a] = await tx.select().from(printAttempts).where(and(eq(printAttempts.jobId, id), eq(printAttempts.attemptNo, b.attemptNo!)));
    if (!a) return { code: 404, body: { error: "Attempt not found" } };
    if (!["queued", "printing"].includes(a.status)) return { code: 409, body: { error: "Attempt already finished" } };
    const total = job.pages * job.copies;
    const printed = Math.max(0, Math.min(total, Math.round(Number(b.pagesPrinted ?? 0))));
    const terminal = b.status !== "printing";
    await tx.update(printAttempts).set({ status: b.status!, pagesPrinted: printed, error: b.error?.slice(0, 300) ?? null, cupsJobId: b.cupsJobId ?? a.cupsJobId, endedAt: terminal ? new Date() : null }).where(eq(printAttempts.id, a.id));
    const jobStatus = b.status === "printing" ? "printing" : b.status === "succeeded" ? "completed" : printed > 0 ? "partially_completed" : "failed";
    await tx.update(printJobs).set({ status: jobStatus, pagesPrinted: b.status === "succeeded" ? total : Math.max(job.pagesPrinted, printed), errorCode: b.status === "failed" || b.status === "partial" ? "printer_error" : null, errorMessage: b.error?.slice(0, 300) ?? null, updatedAt: new Date() }).where(eq(printJobs.id, id));
    if (b.status === "succeeded" && a.printerId) await tx.update(printers).set({ lastSuccessfulPrintAt: new Date() }).where(eq(printers.id, a.printerId));
    await tx.insert(jobLogs).values({ jobId: id, level: b.status === "failed" ? "error" : "info", message: `Attempt #${a.attemptNo}: ${b.status} (${printed}/${total} pages)${b.error ? ` — ${b.error}` : ""}` });
    return { code: 200, body: { ok: true } };
  });
  return Response.json(res.body, { status: res.code });
}
