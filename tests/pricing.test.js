const test = require("node:test");
const assert = require("node:assert");

// Pure pricing calculation validation
function calcQuote({ pages, copies, sided, colorMode, bwRate = 2, colorRate = 8 }) {
  const logicalPages = Math.max(1, pages);
  const physicalSheets = sided === "double" ? Math.ceil(logicalPages / 2) : logicalPages;
  const totalSheets = physicalSheets * Math.max(1, copies);
  const ratePerSheet = colorMode === "color" ? colorRate : bwRate;
  const totalAmount = totalSheets * ratePerSheet;
  const amountPaise = totalAmount * 100;

  return {
    logicalPages,
    physicalSheets,
    totalSheets,
    ratePerSheet,
    totalAmount,
    amountPaise,
  };
}

test("Pricing: Single-sided B&W calculation at SGU standard rate (₹2)", () => {
  const quote = calcQuote({ pages: 10, copies: 1, sided: "single", colorMode: "bw" });
  assert.strictEqual(quote.physicalSheets, 10);
  assert.strictEqual(quote.totalSheets, 10);
  assert.strictEqual(quote.totalAmount, 20);
  assert.strictEqual(quote.amountPaise, 2000);
});

test("Pricing: Double-sided (duplex) B&W calculation", () => {
  const quote = calcQuote({ pages: 9, copies: 1, sided: "double", colorMode: "bw" });
  assert.strictEqual(quote.physicalSheets, 5); // 9 pages / 2 = 4.5 -> 5 sheets
  assert.strictEqual(quote.totalAmount, 10); // 5 sheets * ₹2 = ₹10
  assert.strictEqual(quote.amountPaise, 1000);
});

test("Pricing: Colour single-sided calculation at SGU standard rate (₹8)", () => {
  const quote = calcQuote({ pages: 5, copies: 2, sided: "single", colorMode: "color" });
  assert.strictEqual(quote.physicalSheets, 5);
  assert.strictEqual(quote.totalSheets, 10); // 5 * 2 = 10 sheets
  assert.strictEqual(quote.totalAmount, 80); // 10 sheets * ₹8 = ₹80
  assert.strictEqual(quote.amountPaise, 8000);
});

test("Pricing: Colour double-sided with multi-copies", () => {
  const quote = calcQuote({ pages: 11, copies: 3, sided: "double", colorMode: "color" });
  assert.strictEqual(quote.physicalSheets, 6); // ceil(11/2) = 6
  assert.strictEqual(quote.totalSheets, 18); // 6 * 3 = 18
  assert.strictEqual(quote.totalAmount, 144); // 18 * ₹8 = ₹144
  assert.strictEqual(quote.amountPaise, 14400);
});

