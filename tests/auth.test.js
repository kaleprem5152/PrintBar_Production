const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    const computed = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(hash, "hex");
    return computed.length === storedBuf.length && crypto.timingSafeEqual(computed, storedBuf);
  }
  if (stored.includes(":")) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const computed = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(hash, "hex");
    return computed.length === storedBuf.length && crypto.timingSafeEqual(computed, storedBuf);
  }
  return false;
}

test("Auth: Password hashing creates valid scrypt dollar format", () => {
  const hashed = hashPassword("PrintBar@2026");
  assert.match(hashed, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.strictEqual(verifyPassword("PrintBar@2026", hashed), true);
  assert.strictEqual(verifyPassword("WrongPassword", hashed), false);
});

test("Auth: Legacy colon salt:hash format verification", () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync("PrintBar@2026", salt, 64).toString("hex");
  const legacyStored = `${salt}:${hash}`;
  assert.strictEqual(verifyPassword("PrintBar@2026", legacyStored), true);
  assert.strictEqual(verifyPassword("WrongPass", legacyStored), false);
});

