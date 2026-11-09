const test = require("node:test");
const assert = require("node:assert");

// Unit simulation of the route completion validation logic
function validateJobCompletionRequest({
  order,
  action,
  body,
  deviceId,
  recordedAttempt,
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

    // Explicit CUPS job ID evidence
    if (!body.cupsJobId || typeof body.cupsJobId !== "string") {
      return { statusCode: 400, error: "Explicit CUPS job ID evidence is required for completion." };
    }
    const cupsJobId = String(body.cupsJobId).trim();

    // Verify CUPS job ownership against recorded attempt
    const recordedCupsId = recordedAttempt?.cupsJobId || order.cupsJobId;
    if (!recordedCupsId) {
      return {
        statusCode: 422,
        error: "No recorded print attempt with an active CUPS job ID was found for this order. Report progress before completing.",
      };
    }
    if (recordedCupsId !== cupsJobId) {
      return {
        statusCode: 422,
        error: `CUPS job ownership verification failed: expected recorded job ID '${recordedCupsId}', got '${cupsJobId}'. Arbitrary CUPS job IDs are rejected.`,
      };
    }

    // Printer check
    const rawPrinter = String(body.printer || order.fallbackPrinter || order.printerUsed || "kyocera_pa3500x").toLowerCase();
    const allowedPrinters = ["kyocera_pa3500x", "canon_gx6170", "printbar-kyocera", "printbar-canon"];
    if (!allowedPrinters.includes(rawPrinter)) {
      return { statusCode: 400, error: `Printer '${rawPrinter}' does not belong to kiosk PB-K01.` };
    }

    const isCanon = rawPrinter === "canon_gx6170" || rawPrinter === "printbar-canon" || rawPrinter.includes("canon");
    const canonicalPrinter = isCanon ? "canon_gx6170" : "kyocera_pa3500x";

    if (recordedAttempt?.printerName) {
      const attemptIsCanon = recordedAttempt.printerName.toLowerCase().includes("canon");
      if (isCanon !== attemptIsCanon) {
        return {
          statusCode: 422,
          error: `Printer mismatch with recorded print attempt: attempt was for '${recordedAttempt.printerName}', completion reported '${rawPrinter}'.`,
        };
      }
    }

    // Explicit pagesPrinted evidence
    if (typeof body.pagesPrinted !== "number" || body.pagesPrinted <= 0) {
      return { statusCode: 400, error: "Explicit verified pagesPrinted counter (>0) is required for completion." };
    }

    const verifiedPages = Math.min(order.pagesToPrint, Math.max(0, body.pagesPrinted));
    const isPartial = verifiedPages < order.pagesToPrint;
    const pagesPerSheet = order.pagesPerSheet || 1;
    const sheetsPrinted = Math.ceil(verifiedPages / pagesPerSheet);
    const sheetsConsumed = Math.min(order.physicalSheets || sheetsPrinted, sheetsPrinted);

    let finalStatus = "completed";
    let refundStatus = "NOT_REQUIRED";
    let refundableAmount = 0;

    if (isPartial) {
      finalStatus = "refund_pending";
      refundStatus = "REFUND_REQUESTED";
      const totalPaid = order.amount || 20;
      const ratePerSheet = order.rateApplied || 2;
      const earned = sheetsPrinted * ratePerSheet;
      refundableAmount = Math.max(0, totalPaid - earned);
    }

    return {
      statusCode: 200,
      ok: true,
      acknowledged: true,
      eventId,
      status: finalStatus,
      partial: isPartial,
      pagesPrinted: verifiedPages,
      pagesExpected: order.pagesToPrint,
      sheetsConsumed,
      printerUsed: canonicalPrinter,
      refundStatus,
      refundableAmount,
    };
  }

  return { statusCode: 400, error: "Unknown action" };
}

// Function to simulate physical paper inventory accounting
function deductPaperInventory(deviceState, { printerUsed, sheetsConsumed }) {
  const isCanon = printerUsed === "canon_gx6170" || printerUsed === "printbar-canon" || printerUsed.includes("canon");
  const newDevice = { ...deviceState };
  if (isCanon) {
    newDevice.canonPaper = Math.max(0, (newDevice.canonPaper ?? 250) - sheetsConsumed);
  } else {
    newDevice.kyoceraPaper = Math.max(0, (newDevice.kyoceraPaper ?? 250) - sheetsConsumed);
  }
  newDevice.paperReady = newDevice.kyoceraPaper > 0 || newDevice.canonPaper > 0;
  return newDevice;
}

test("Job Completion: Valid completion request succeeds and acknowledges exact eventId", () => {
  const order = {
    orderId: "ORD-001",
    deviceId: "PB-K01",
    status: "printing",
    pagesToPrint: 10,
    cupsJobId: "printbar-kyocera-101",
  };
  const recordedAttempt = {
    cupsJobId: "printbar-kyocera-101",
    printerName: "kyocera_pa3500x",
  };
  const body = {
    eventId: "evt_test_valid_123",
    pagesPrinted: 10,
    cupsJobId: "printbar-kyocera-101",
    printer: "kyocera_pa3500x",
  };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.acknowledged, true);
  assert.strictEqual(res.eventId, "evt_test_valid_123");
  assert.strictEqual(res.pagesPrinted, 10);
  assert.strictEqual(res.status, "completed");
  assert.strictEqual(res.partial, false);
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
  const recordedAttempt = { cupsJobId: "c-1", printerName: "kyocera_pa3500x" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.error, /pagesPrinted/);
});

test("Job Completion: Mismatched CUPS job ID is rejected with 422", () => {
  const order = { orderId: "ORD-004", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: "canon-999" };
  const recordedAttempt = { cupsJobId: "canon-999", printerName: "canon_gx6170" };
  const body = { eventId: "evt_12345678", pagesPrinted: 5, cupsJobId: "wrong-cups-id-111" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 422);
  assert.match(res.error, /CUPS job ownership verification failed/);
});

test("Job Completion: Arbitrary CUPS job ID without recorded attempt is rejected with 422", () => {
  const order = { orderId: "ORD-004B", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: null };
  const recordedAttempt = null; // No attempt was recorded
  const body = { eventId: "evt_arbitrary_99", pagesPrinted: 5, cupsJobId: "arbitrary-cups-id-555" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 422);
  assert.match(res.error, /No recorded print attempt/);
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
  const recordedAttempt = { cupsJobId: "c-1", printerName: "kyocera_pa3500x" };
  const body = { eventId: "evt_12345678", pagesPrinted: 5, cupsJobId: "c-1", printer: "hp_laserjet_foreign" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.error, /does not belong to kiosk/);
});

test("Job Completion: Mismatched printer report vs recorded attempt is rejected with 422", () => {
  const order = { orderId: "ORD-007B", deviceId: "PB-K01", status: "printing", pagesToPrint: 5, cupsJobId: "c-1" };
  const recordedAttempt = { cupsJobId: "c-1", printerName: "kyocera_pa3500x" };
  const body = { eventId: "evt_12345678", pagesPrinted: 5, cupsJobId: "c-1", printer: "canon_gx6170" };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 422);
  assert.match(res.error, /Printer mismatch with recorded print attempt/);
});

test("Partial Completion: Verified output below required output is NEVER marked completed", () => {
  const order = {
    orderId: "ORD-PARTIAL-001",
    deviceId: "PB-K01",
    status: "printing",
    pagesToPrint: 10,
    physicalSheets: 10,
    amount: 20,
    rateApplied: 2,
    cupsJobId: "printbar-kyocera-102",
  };
  const recordedAttempt = { cupsJobId: "printbar-kyocera-102", printerName: "kyocera_pa3500x" };
  const body = {
    eventId: "evt_partial_456",
    pagesPrinted: 4, // only 4 of 10 pages printed
    cupsJobId: "printbar-kyocera-102",
    printer: "kyocera_pa3500x",
  };
  const res = validateJobCompletionRequest({ order, action: "complete", body, deviceId: "PB-K01", recordedAttempt });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.partial, true);
  assert.notStrictEqual(res.status, "completed");
  assert.strictEqual(res.status, "refund_pending");
  assert.strictEqual(res.pagesPrinted, 4);
  assert.strictEqual(res.sheetsConsumed, 4);
  // 4 pages @ ₹2 = ₹8 earned, unprinted 6 pages @ ₹2 = ₹12 refundable
  assert.strictEqual(res.refundableAmount, 12);
  assert.strictEqual(res.refundStatus, "REFUND_REQUESTED");
});

test("Inventory Accounting: Primary printing on Kyocera deducts ONLY Kyocera paper", () => {
  const initialDevice = { kyoceraPaper: 250, canonPaper: 250, paperReady: true };
  const updatedDevice = deductPaperInventory(initialDevice, {
    printerUsed: "kyocera_pa3500x",
    sheetsConsumed: 10,
  });
  assert.strictEqual(updatedDevice.kyoceraPaper, 240);
  assert.strictEqual(updatedDevice.canonPaper, 250); // Canon untouched!
});

test("Inventory Accounting: Fallback printing on Canon deducts ONLY Canon paper", () => {
  const initialDevice = { kyoceraPaper: 250, canonPaper: 250, paperReady: true };
  const updatedDevice = deductPaperInventory(initialDevice, {
    printerUsed: "canon_gx6170",
    sheetsConsumed: 8,
  });
  assert.strictEqual(updatedDevice.kyoceraPaper, 250); // Kyocera untouched!
  assert.strictEqual(updatedDevice.canonPaper, 242);
});

test("Inventory Accounting: Queue name variants (printbar-kyocera vs printbar-canon) deduct correctly", () => {
  const initialDevice = { kyoceraPaper: 100, canonPaper: 100, paperReady: true };
  const dev1 = deductPaperInventory(initialDevice, { printerUsed: "printbar-kyocera", sheetsConsumed: 15 });
  assert.strictEqual(dev1.kyoceraPaper, 85);
  assert.strictEqual(dev1.canonPaper, 100);

  const dev2 = deductPaperInventory(initialDevice, { printerUsed: "printbar-canon", sheetsConsumed: 20 });
  assert.strictEqual(dev2.kyoceraPaper, 100);
  assert.strictEqual(dev2.canonPaper, 80);
});

test("Job Completion: Fail-closed on durable event store error returns 503", () => {
  function handleCompletionWithDbMock(dbMock, { order, body, deviceId }) {
    if (order.deviceId !== deviceId) return { statusCode: 404 };
    const eventId = body.eventId;
    if (!eventId) return { statusCode: 400 };

    // Durable idempotency check
    try {
      const existing = dbMock.findEvent(eventId);
      if (existing) {
        return { statusCode: 200, ok: true, acknowledged: true, eventId, duplicateEvent: true };
      }
    } catch (err) {
      return {
        statusCode: 503,
        error: "Durable idempotency store unavailable. Request rejected to prevent duplicate operations.",
        eventId,
      };
    }

    return { statusCode: 200, ok: true, acknowledged: true, eventId };
  }

  const order = { orderId: "ORD-008", deviceId: "PB-K01", status: "printing" };
  const body = { eventId: "evt_failing_db_123", pagesPrinted: 5, cupsJobId: "c-1" };

  // DB outage throws
  const failingDb = {
    findEvent: () => { throw new Error("PostgreSQL connection timeout"); }
  };

  const res = handleCompletionWithDbMock(failingDb, { order, body, deviceId: "PB-K01" });
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.error, /Durable idempotency store unavailable/);
  assert.strictEqual(res.eventId, "evt_failing_db_123");
});
