const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

function normalizeCanonicalPath(urlOrPath) {
  try {
    let pathname = urlOrPath;
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      pathname = new URL(urlOrPath).pathname;
    } else {
      pathname = urlOrPath.split("?")[0].split("#")[0];
    }
    pathname = pathname.replace(/\/+/g, "/").replace(/\/$/, "");
    return pathname.startsWith("/") ? pathname : "/" + pathname;
  } catch {
    return urlOrPath;
  }
}

function buildCanonicalMessage(method, path, timestamp, nonce, bodySha256) {
  const normMethod = method.trim().toUpperCase();
  const normPath = normalizeCanonicalPath(path);
  const normSha = bodySha256.trim().toLowerCase();
  return `${normMethod}:${normPath}:${timestamp}:${nonce}:${normSha}`;
}

function generateCanonicalDeviceSignature(method, path, ts, nonce, bodyBytes, secret) {
  const bodySha256 = crypto.createHash("sha256").update(bodyBytes || "").digest("hex");
  const message = buildCanonicalMessage(method, path, ts, nonce, bodySha256);
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function verifyCanonicalDeviceSignature(method, path, ts, nonce, bodyBytes, signature, secret, maxSkew = 120) {
  if (maxSkew !== null) {
    const tsNum = parseInt(ts, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(tsNum) || Math.abs(now - tsNum) > maxSkew) {
      return { ok: false, error: "Timestamp expired or out of window" };
    }
  }

  const expectedCanonical = generateCanonicalDeviceSignature(method, path, ts, nonce, bodyBytes, secret);
  const givenBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expectedCanonical, "utf8");

  if (givenBuf.length !== expBuf.length || !crypto.timingSafeEqual(expBuf, givenBuf)) {
    return { ok: false, error: "Invalid signature" };
  }

  return { ok: true };
}

test("Device Auth: Exact shared Python/TypeScript test vector matches", () => {
  const secret = "shared-test-secret-printbar-2026-xyz";
  const method = "POST";
  const path = "/api/device/jobs/PB-2026-00042?action=complete";
  const ts = "1762700000";
  const nonce = "testnonce1234567890abcdef";
  const body = JSON.stringify({ pagesPrinted: 10, status: "completed" });
  const expectedSig = "23aad655898c3de53600511760ff15208d7d8a46150205d29e2fa0420161ba59";

  const sig = generateCanonicalDeviceSignature(method, path, ts, nonce, body, secret);
  assert.strictEqual(sig, expectedSig);

  const result = verifyCanonicalDeviceSignature(method, path, ts, nonce, body, sig, secret, null);
  assert.strictEqual(result.ok, true);
});

test("Device Auth: Valid Canonical HMAC signature with body hash passes", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const method = "POST";
  const path = "/api/device/jobs/PB-2026-00003";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const body = JSON.stringify({ pagesPrinted: 5, status: "printing" });

  const sig = generateCanonicalDeviceSignature(method, path, now, nonce, body, secret);
  const result = verifyCanonicalDeviceSignature(method, path, now, nonce, body, sig, secret);
  assert.strictEqual(result.ok, true);
});

test("Device Auth: Body tampering invalidates HMAC signature", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const method = "PATCH";
  const path = "/api/device/jobs/PB-2026-00003";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const originalBody = JSON.stringify({ pagesPrinted: 5 });
  const tamperedBody = JSON.stringify({ pagesPrinted: 99 });

  const sig = generateCanonicalDeviceSignature(method, path, now, nonce, originalBody, secret);
  const result = verifyCanonicalDeviceSignature(method, path, now, nonce, tamperedBody, sig, secret);
  assert.strictEqual(result.ok, false);
});

test("Device Auth: Expired timestamp (>120s) is rejected", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const method = "GET";
  const path = "/api/device/jobs";
  const oldTs = (Math.floor(Date.now() / 1000) - 200).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const sig = generateCanonicalDeviceSignature(method, path, oldTs, nonce, "", secret);
  const result = verifyCanonicalDeviceSignature(method, path, oldTs, nonce, "", sig, secret);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Timestamp expired/);
});

test("Device Auth: Tampered signature is rejected", () => {
  const secret = "super-secret-pi-key-2026-canonical";
  const method = "POST";
  const path = "/api/agent/heartbeat";
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const tamperedSig = "deadbeef".repeat(8);
  const result = verifyCanonicalDeviceSignature(method, path, now, nonce, "", tamperedSig, secret);
  assert.strictEqual(result.ok, false);
});
