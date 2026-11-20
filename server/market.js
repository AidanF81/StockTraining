// Works out if the market is open right now.
// Tables used:
//   MarketHours    (OpeningTime, ClosingTime)  one row, the daily open and close time
//   MarketSchedule (Date, IsOpen)              one row per day the admin changed
//
// Rules:
//   - Saturday and Sunday are closed unless the admin marked that date open
//   - A weekday is open unless the admin marked that date closed (holiday)
//   - On an open day, trading is allowed from OpeningTime up to ClosingTime
//
// Times are in the market time zone, set with MARKET_TZ in .env (default America/Phoenix).
// The EC2 server clock is UTC so we cant just use the server time.

const db = require('./db');

const MARKET_TZ = process.env.MARKET_TZ || 'America/Phoenix';
const DEFAULT_OPEN = '09:00:00';
const DEFAULT_CLOSE = '16:00:00';

// Current date, time and weekday in the market time zone.
function marketNow(now = new Date()) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: MARKET_TZ, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(now).forEach((p) => { parts[p.type] = p.value; });
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}:${parts.second}`,
        weekday: parts.weekday
    };
}

function isWeekend(dateString) {
    // noon UTC so the weekday is the same no matter what time zone the server is in
    const day = new Date(`${dateString}T12:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
}

// IsOpen is a BINARY(1) column that holds the character '1' or '0', so it comes back as a Buffer.
function readOpenFlag(value) {
    if (Buffer.isBuffer(value)) return value.length > 0 && (value[0] === 0x31 || value[0] === 1);
    if (typeof value === 'string') return value === '1';
    return Number(value) === 1;
}
function writeOpenFlag(open) {
    return Buffer.from(open ? '1' : '0');
}

// 'HH:MM:SS' no matter how MySQL hands the TIME back
function cleanTime(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value || ''));
    if (!match) return fallback;
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}

async function getHours(q = db) {
    const [rows] = await q.query('SELECT OpeningTime, ClosingTime FROM MarketHours LIMIT 1');
    if (!rows[0]) return { openingTime: DEFAULT_OPEN, closingTime: DEFAULT_CLOSE, isDefault: true };
    return {
        openingTime: cleanTime(rows[0].OpeningTime, DEFAULT_OPEN),
        closingTime: cleanTime(rows[0].ClosingTime, DEFAULT_CLOSE),
        isDefault: false
    };
}

// Is one date a trading day? Returns { open, reason, changedByAdmin }
function dayStatus(dateString, override) {
    const weekend = isWeekend(dateString);
    const open = override === undefined ? !weekend : override;
    return {
        open,
        reason: open ? null : (weekend ? 'Weekend' : 'Holiday'),
        changedByAdmin: override !== undefined
    };
}

async function getDayOverride(dateString, q = db) {
    const [rows] = await q.query('SELECT IsOpen FROM MarketSchedule WHERE `Date` = ? LIMIT 1', [dateString]);
    return rows[0] ? readOpenFlag(rows[0].IsOpen) : undefined;
}

// Full status for right now. Used by buy/sell, the Buy/Sell page and the price generator.
async function getStatus(q = db) {
    const now = marketNow();
    const hours = await getHours(q);
    const day = dayStatus(now.date, await getDayOverride(now.date, q));

    let open = day.open;
    let reason = day.reason;
    if (open && (now.time < hours.openingTime || now.time >= hours.closingTime)) {
        open = false;
        reason = 'Outside market hours';
    }
    return {
        open,
        reason,
        date: now.date,
        time: now.time,
        weekday: now.weekday,
        openingTime: hours.openingTime,
        closingTime: hours.closingTime,
        timeZone: MARKET_TZ
    };
}

module.exports = { MARKET_TZ, marketNow, isWeekend, readOpenFlag, writeOpenFlag, getHours, dayStatus, getDayOverride, getStatus };
