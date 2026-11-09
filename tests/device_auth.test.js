const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

function generateDeviceSignature(deviceId, ts, nonce, secret) {
  const message = nonce ? `${deviceId}:${ts}:${nonce}` : `${deviceId}:${ts}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function verifyDeviceSignature(deviceId, ts, nonce, token, secret) {
  const tsNum = parseInt(ts, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(tsNum) || Math.abs(now - tsNum) > 60) {
    return { ok: false, error: "Timestamp expired or out of window" };
  }

  const expectedWithNonce = generateDeviceSignature(deviceId, ts, nonce, secret);
  const expectedLegacy = generateDeviceSignature(deviceId, ts, "", secret);

  const givenBuf = Buffer.from(token, "utf8");
  const exp1Buf = Buffer.from(expectedWithNonce, "utf8");
  const exp2Buf = Buffer.from(expectedLegacy, "utf8");

  const m1 = exp1Buf.length === givenBuf.length && crypto.timingSafeEqual(exp1Buf, givenBuf);
  const m2 = exp2Buf.length === givenBuf.length && crypto.timingSafeEqual(exp2Buf, givenBuf);

  if (!m1 && !m2) {
    return { ok: false, error: "Invalid signature" };
  }

  return { ok: true };
}

test("Device Auth: Valid HMAC signature with nonce passes verification", () => {
  const secret = "super-secret-pi-key-2026";
  const deviceId = "PB-K01";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const sig = generateDeviceSignature(deviceId, now, nonce, secret);
  const result = verifyDeviceSignature(deviceId, now, nonce, sig, secret);
  assert.strictEqual(result.ok, true);
});

test("Device Auth: Expired timestamp (>60s) is rejected", () => {
  const secret = "super-secret-pi-key-2026";
  const deviceId = "PB-K01";
  const oldTs = (Math.floor(Date.now() / 1000) - 120).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const sig = generateDeviceSignature(deviceId, oldTs, nonce, secret);
  const result = verifyDeviceSignature(deviceId, oldTs, nonce, sig, secret);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Timestamp expired/);
});

test("Device Auth: Tampered signature is rejected", () => {
  const secret = "super-secret-pi-key-2026";
  const deviceId = "PB-K01";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const tamperedSig = "deadbeef".repeat(8);
  const result = verifyDeviceSignature(deviceId, now, nonce, tamperedSig, secret);
  assert.strictEqual(result.ok, false);
});

