const test = require("node:test");
const assert = require("node:assert");

// Unit simulation of the route completion validation logic
function validateJobCompletionRequest({
  order,
  action,
  body,
  deviceId,
}) {
  // Device ownership
  if (order.deviceId !== deviceId) {
    return { statusCode: 404, error: "Order not found or device mismatch." };
  }

  // Event ID requirement
  const eventId = body.eventId;
  if (!eventId || typeof eventId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(eventId)) {
    return { statusCode: 400, error: "Missing or invalid completion eventId." };
  }

  if (action === "complete") {
    // Idempotency: if already completed
    if (order.status === "completed") {
      return { statusCode: 200, ok: true, acknowledged: true, eventId, status: "completed", alreadyCompleted: true };
    }

    // State machine check
    const allowedSourceStates = ["queued", "processing", "printing", "fallback_pending"];
    if (!allowedSourceStates.includes(order.status)) {
      return { statusCode: 409, error: `Cannot complete job from state '${order.status}'.` };
    }

    // Explicit pagesPrinted evidence
    if (typeof body.pagesPrinted !== "number" || body.pagesPrinted <= 0) {
      return { statusCode: 400, error: "Explicit verified pagesPrinted counter (>0) is required for completion." };
    }

    // Explicit CUPS job ID evidence
    if (!body.cupsJobId || typeof body.cupsJobId !== "string") {
      return { statusCode: 400, error: "Explicit CUPS job ID evidence is required for completion." };
    }

    if (order.cupsJobId && body.cupsJobId !== order.cupsJobId) {
      return { statusCode: 422, error: `Mismatched CUPS job ID: expected '${order.cupsJobId}', got '${body.cupsJobId}'.` };
    }

    // Printer check
    const printerUsed = body.printer || order.fallbackPrinter || order.printerUsed || "kyocera_pa3500x";
    const allowedPrinters = ["kyocera_pa3500x", "canon_gx6170", "printbar-kyocera", "printbar-canon"];
    if (!allowedPrinters.includes(printerUsed)) {
      return { statusCode: 400, error: `Printer '${printerUsed}' does not belong to kiosk PB-K01.` };
    }

    return {
      statusCode: 200,
      ok: true,
      acknowledged: true,
      eventId,
      status: "completed",
      pagesPrinted: Math.min(order.pagesToPrint, body.pagesPrinted),
    };
  }

  return { statusCode: 400, error: "Unknown action" };
}

test("Job Completion: Valid completion request succeeds and acknowledges exact eventId", () => {
  const order = {
    orderId: "ORD-001",
    deviceId: "PB-K01",
    status: "printing",
    pagesToPrint: 10,
    cupsJobId: "printbar-kyocera-101",
  };
  const body = {
    eventId: "evt_test_valid_123",
    pagesPrinted: 10,
    cupsJobId: "printbar-kyocera-101",
  };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.acknowledged, true);
  assert.strictEqual(res.eventId, "evt_test_valid_123");
  assert.strictEqual(res.pagesPrinted, 10);
});

test("Job Completion: Missing eventId is rejected with 400", () => {
  const order = { orderId: "ORD-002", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: "c-1" };
  const body = { pagesPrinted: 5, cupsJobId: "c-1" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.error, /eventId/);
});

test("Job Completion: Missing pagesPrinted counter is rejected with 400", () => {
  const order = { orderId: "ORD-003", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: "c-1" };
  const body = { eventId: "evt_12345678", cupsJobId: "c-1" }; // missing pagesPrinted
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.error, /pagesPrinted/);
});

test("Job Completion: Mismatched CUPS job ID is rejected with 422", () => {
  const order = { orderId: "ORD-004", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: "canon-999" };
  const body = { eventId: "evt_12345678", pagesPrinted: 5, cupsJobId: "wrong-cups-id-111" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 422);
  assert.match(res.error, /Mismatched CUPS job ID/);
});

test("Job Completion: Invalid state transition (e.g. from failed or cancelled) is rejected with 409", () => {
  const order = { orderId: "ORD-005", deviceId: "PB-K01", status: "cancelled", pagesToPrint: 5, cupsJobId: "c-1" };
  const body = { eventId: "evt_12345678", pagesPrinted: 5, cupsJobId: "c-1" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 409);
  assert.match(res.error, /Cannot complete job from state/);
});

test("Job Completion: Idempotent re-submission on already completed order succeeds without error", () => {
  const order = { orderId: "ORD-006", deviceId: "PB-K01", status: "completed", pagesToPrint: 5, cupsJobId: "c-1" };
  const body = { eventId: "evt_resend_999", pagesPrinted: 5, cupsJobId: "c-1" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.alreadyCompleted, true);
  assert.strictEqual(res.eventId, "evt_resend_999");
});

test("Job Completion: Printer not belonging to kiosk PB-K01 is rejected with 400", () => {
  const order = { orderId: "ORD-007", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: "c-1" };
  const body = { eventId: "evt_12345678", pagesPrinted: 5, cupsJobId: "c-1", printer: "hp_laserjet_foreign" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.error, /does not belong to kiosk/);
});
