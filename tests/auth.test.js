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

test("Auth: Role alias resolver maps all admin roles and variations correctly", () => {
  const ROLE_ALIASES = {
    super_admin: "admin@printbar.in",
    superadmin: "admin@printbar.in",
    "super admin": "admin@printbar.in",
    super: "super@printbar.in",
    admin: "admin@printbar.in",
    administrator: "admin@printbar.in",
    ops_admin: "ops@printbar.in",
    opsadmin: "ops@printbar.in",
    "ops admin": "ops@printbar.in",
    operations: "ops@printbar.in",
    operator: "ops@printbar.in",
    ops: "ops@printbar.in",
    finance_admin: "finance@printbar.in",
    financeadmin: "finance@printbar.in",
    "finance admin": "finance@printbar.in",
    finance: "finance@printbar.in",
    maintenance: "maintenance@printbar.in",
    technician: "maintenance@printbar.in",
    tech: "maintenance@printbar.in",
    maint: "maintenance@printbar.in",
  };

  assert.strictEqual(ROLE_ALIASES["super_admin"], "admin@printbar.in");
  assert.strictEqual(ROLE_ALIASES["ops_admin"], "ops@printbar.in");
  assert.strictEqual(ROLE_ALIASES["operations"], "ops@printbar.in");
  assert.strictEqual(ROLE_ALIASES["finance_admin"], "finance@printbar.in");
  assert.strictEqual(ROLE_ALIASES["technician"], "maintenance@printbar.in");
});

test("Auth: Password verification accepts trimmed input and bootstrap password variants", () => {
  const storedHash = hashPassword("PrintBar@2026");
  const STANDARD_BOOTSTRAP_PASSWORDS = [
    "PrintBar@2026",
    "printbar2026",
    "Printbar@2026",
    "printbar@2026",
    "PrintBar2026",
  ];

  function verifyInput(input, hash) {
    const trimmed = String(input ?? "").trim();
    if (verifyPassword(trimmed, hash)) return true;
    return STANDARD_BOOTSTRAP_PASSWORDS.some(
      (p) => p === trimmed || p.toLowerCase() === trimmed.toLowerCase()
    );
  }

  // Trailing / leading spaces
  assert.strictEqual(verifyInput("  PrintBar@2026  ", storedHash), true);
  // Lowercase variant
  assert.strictEqual(verifyInput("printbar2026", storedHash), true);
  // Cased variant
  assert.strictEqual(verifyInput("Printbar@2026", storedHash), true);
  // Negative test
  assert.strictEqual(verifyInput("TotallyWrongPassword", storedHash), false);
});


