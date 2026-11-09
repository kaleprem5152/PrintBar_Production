const test = require("node:test");
const assert = require("node:assert");

function calculateRefundAmount(order, pagesPrinted) {
  const totalPaid = order.amount;
  const totalPages = order.pagesToPrint;
  const physicalSheets = order.physicalSheets || totalPages;
  const ratePerSheet = order.rateApplied;

  if (pagesPrinted <= 0) {
    return {
      refundableAmount: totalPaid,
      earnedAmount: 0,
      requiresReview: false,
      reason: "Complete print failure — 100% full refund",
    };
  }

  if (pagesPrinted >= totalPages) {
    return {
      refundableAmount: 0,
      earnedAmount: totalPaid,
      requiresReview: false,
      reason: "All pages printed — no refund due",
    };
  }

  // Partial print
  const pagesPerSheet = order.pagesPerSheet || 1;
  const sheetsPrinted = Math.ceil(pagesPrinted / pagesPerSheet);
  const earnedAmount = sheetsPrinted * ratePerSheet;
  const unearnedAmount = Math.max(0, totalPaid - earnedAmount);

  return {
    refundableAmount: unearnedAmount,
    earnedAmount,
    requiresReview: false,
    reason: `Partial hardware failure: ${pagesPrinted}/${totalPages} printed. Refund for remaining ${totalPages - pagesPrinted} pages.`,
  };
}

test("Refunds: Total print failure receives 100% full refund", () => {
  const order = { amount: 50, pagesToPrint: 25, physicalSheets: 25, rateApplied: 2 };
  const res = calculateRefundAmount(order, 0);
  assert.strictEqual(res.refundableAmount, 50);
  assert.strictEqual(res.earnedAmount, 0);
  assert.strictEqual(res.requiresReview, false);
});

test("Refunds: Full completion results in zero refund", () => {
  const order = { amount: 50, pagesToPrint: 25, physicalSheets: 25, rateApplied: 2 };
  const res = calculateRefundAmount(order, 25);
  assert.strictEqual(res.refundableAmount, 0);
  assert.strictEqual(res.earnedAmount, 50);
});

test("Refunds: Partial failure at 10 of 20 sheets refunds exactly unprinted balance", () => {
  const order = { amount: 40, pagesToPrint: 20, physicalSheets: 20, rateApplied: 2, pagesPerSheet: 1 };
  const res = calculateRefundAmount(order, 10);
  assert.strictEqual(res.earnedAmount, 20); // 10 sheets * ₹2 = ₹20 earned
  assert.strictEqual(res.refundableAmount, 20); // ₹40 - ₹20 = ₹20 refundable
});

