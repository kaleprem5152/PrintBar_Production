const test = require("node:test");
const assert = require("node:assert");

function calculateFailoverRange(totalPages, pagesAlreadyPrinted) {
  if (pagesAlreadyPrinted >= totalPages) {
    return { needsFailover: false, remainingRange: null, remainingPages: 0 };
  }
  const startPage = pagesAlreadyPrinted + 1;
  const endPage = totalPages;
  const remainingPages = endPage - startPage + 1;
  const remainingRange = startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`;

  return {
    needsFailover: true,
    startPage,
    endPage,
    remainingPages,
    remainingRange,
  };
}

test("Failover: Mid-print failure at page 4 of 10 routes pages 5-10 to backup Canon", () => {
  const result = calculateFailoverRange(10, 4);
  assert.strictEqual(result.needsFailover, true);
  assert.strictEqual(result.startPage, 5);
  assert.strictEqual(result.endPage, 10);
  assert.strictEqual(result.remainingPages, 6);
  assert.strictEqual(result.remainingRange, "5-10");
});

test("Failover: Failure on initial page 0 routes entire document 1-15", () => {
  const result = calculateFailoverRange(15, 0);
  assert.strictEqual(result.needsFailover, true);
  assert.strictEqual(result.remainingRange, "1-15");
  assert.strictEqual(result.remainingPages, 15);
});

test("Failover: Failure on penultimate page routes only single remaining page", () => {
  const result = calculateFailoverRange(8, 7);
  assert.strictEqual(result.needsFailover, true);
  assert.strictEqual(result.remainingRange, "8");
  assert.strictEqual(result.remainingPages, 1);
});

test("Failover: Already completed job requires no failover", () => {
  const result = calculateFailoverRange(12, 12);
  assert.strictEqual(result.needsFailover, false);
  assert.strictEqual(result.remainingRange, null);
});

