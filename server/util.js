// Small helpers shared by the routes.

// MySQL can hand back a boolean column as 1/0, true/false, '1', or (for BIT(1)) a Buffer.
function isTrue(value) {
    if (Buffer.isBuffer(value)) return value.length > 0 && value[0] === 1;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return value === true || Number(value) === 1;
}

// Parse a money amount from a form. Returns a number rounded to cents, or null if invalid.
function parseAmount(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 1000000000) return null;
    return Math.round(n * 100) / 100;
}

module.exports = { isTrue, parseAmount };
