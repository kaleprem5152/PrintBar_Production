import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands } from "@/db/schema";

/**
 * Queue a command for the kiosk agent. Commands stay "queued" until the agent polls
 * GET /api/agent/commands and acknowledges — the dashboard never reports them as done on its own.
 */
export async function enqueueCommand(c: {
  kioskId: string;
  printerId?: string | null;
  command: string;
  payload?: Record<string, unknown>;
  by: string;
}) {
  const [dupe] = await db
    .select()
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.kioskId, c.kioskId),
        eq(deviceCommands.command, c.command),
        eq(deviceCommands.status, "queued"),
        c.printerId ? eq(deviceCommands.printerId, c.printerId) : undefined,
      ),
    )
    .limit(1);
  if (dupe && c.command !== "print_job") return { row: dupe, duplicate: true };
  const [row] = await db
    .insert(deviceCommands)
    .values({
      kioskId: c.kioskId,
      printerId: c.printerId ?? null,
      command: c.command,
      payload: c.payload ?? {},
      idempotencyKey: `${c.command}:${c.kioskId}:${c.printerId ?? "-"}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      requestedBy: c.by,
    })
    .returning();
  return { row, duplicate: false };
}

export const COMMAND_LABELS: Record<string, string> = {
  restart_agent: "Restart kiosk agent",
  restart_print_service: "Restart printing service (CUPS)",
  run_diagnostics: "Run device diagnostics",
  fetch_logs: "Collect system logs",
  test_print: "Send test print",
  clear_stuck_jobs: "Clear stuck jobs",
  fetch_cups_queue: "Fetch CUPS queue",
  print_job: "Print job",
};
