const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

function generateCanonicalDeviceSignature(deviceId, ts, nonce, bodyBytes, secret) {
  const bodySha256 = crypto.createHash("sha256").update(bodyBytes || "").digest("hex");
  const message = `${deviceId}:${ts}:${nonce}:${bodySha256}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function verifyCanonicalDeviceSignature(deviceId, ts, nonce, bodyBytes, token, secret) {
  const tsNum = parseInt(ts, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(tsNum) || Math.abs(now - tsNum) > 120) {
    return { ok: false, error: "Timestamp expired or out of window" };
  }

  const expectedCanonical = generateCanonicalDeviceSignature(deviceId, ts, nonce, bodyBytes, secret);
  const givenBuf = Buffer.from(token, "utf8");
  const expBuf = Buffer.from(expectedCanonical, "utf8");

  if (givenBuf.length !== expBuf.length || !crypto.timingSafeEqual(expBuf, givenBuf)) {
    return { ok: false, error: "Invalid signature" };
  }

  return { ok: true };
}

test("Device Auth: Valid Canonical HMAC signature with body hash passes", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const deviceId = "PB-K01";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const body = JSON.stringify({ pagesPrinted: 5, status: "printing" });

  const sig = generateCanonicalDeviceSignature(deviceId, now, nonce, body, secret);
  const result = verifyCanonicalDeviceSignature(deviceId, now, nonce, body, sig, secret);
  assert.strictEqual(result.ok, true);
});

test("Device Auth: Body tampering invalidates HMAC signature", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const deviceId = "PB-K01";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const originalBody = JSON.stringify({ pagesPrinted: 5 });
  const tamperedBody = JSON.stringify({ pagesPrinted: 99 });

  const sig = generateCanonicalDeviceSignature(deviceId, now, nonce, originalBody, secret);
  const result = verifyCanonicalDeviceSignature(deviceId, now, nonce, tamperedBody, sig, secret);
  assert.strictEqual(result.ok, false);
});

test("Device Auth: Expired timestamp (>120s) is rejected", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const deviceId = "PB-K01";
  const oldTs = (Math.floor(Date.now() / 1000) - 200).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const sig = generateCanonicalDeviceSignature(deviceId, oldTs, nonce, "", secret);
  const result = verifyCanonicalDeviceSignature(deviceId, oldTs, nonce, "", sig, secret);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Timestamp expired/);
});

test("Device Auth: Tampered signature is rejected", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const deviceId = "PB-K01";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const tamperedSig = "deadbeef".repeat(8);
  const result = verifyCanonicalDeviceSignature(deviceId, now, nonce, "", tamperedSig, secret);
  assert.strictEqual(result.ok, false);
});
