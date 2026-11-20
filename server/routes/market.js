// Market routes: is the market open, and the two admin functions (change hours, change schedule).
// Tables used: MarketHours, MarketSchedule

const router = require('express').Router();
const db = require('../db');
const market = require('../market');
const { requireAdmin } = require('../middleware/auth');

// GET /api/market/status -> { open, reason, date, time, openingTime, closingTime, timeZone }
router.get('/market/status', async (req, res) => {
    try {
        res.json(await market.getStatus());
    } catch (err) {
        console.error('[market status]', err);
        res.status(500).json({ error: 'Database error while checking the market' });
    }
});

// POST /api/admin/market/hours { openingHour, closingHour }   (admin)
// Hours are whole hours 0 to 23, same as the dropdowns on the Change Market Hours page.
router.post('/admin/market/hours', requireAdmin, async (req, res) => {
    const body = req.body || {};
    const openingHour = Number(body.openingHour);
    const closingHour = Number(body.closingHour);

    const validHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
    if (body.openingHour === '' || body.closingHour === '' || body.openingHour == null || body.closingHour == null
        || !validHour(openingHour) || !validHour(closingHour)) {
        return res.status(400).json({ error: 'Please select both opening and closing hours' });
    }
    if (openingHour >= closingHour) {
        return res.status(400).json({ error: 'Opening hour must be earlier than closing hour' });
    }

    const openingTime = `${String(openingHour).padStart(2, '0')}:00:00`;
    const closingTime = `${String(closingHour).padStart(2, '0')}:00:00`;

    // The table only ever has one row, so clear it and put the new hours in.
    const conn = await (await db.getPool()).getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM MarketHours');
        await conn.query('INSERT INTO MarketHours (OpeningTime, ClosingTime) VALUES (?, ?)', [openingTime, closingTime]);
        await conn.commit();
        res.json({
            message: `Market hours updated: ${openingTime.slice(0, 5)} to ${closingTime.slice(0, 5)}`,
            openingTime, closingTime, timeZone: market.MARKET_TZ
        });
    } catch (err) {
        await conn.rollback().catch(() => {});
        console.error('[market hours]', err);
        res.status(500).json({ error: 'Database error while saving market hours' });
    } finally {
        conn.release();
    }
});

// GET /api/admin/market/schedule?month=2026-11   (admin)
// -> every day of that month with { date, open, reason, changedByAdmin }
router.get('/admin/market/schedule', requireAdmin, async (req, res) => {
    const month = String(req.query.month || '');
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
        return res.status(400).json({ error: 'Month must look like 2026-11' });
    }
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

    try {
        const [rows] = await db.query(
            "SELECT DATE_FORMAT(`Date`, '%Y-%m-%d') AS d, IsOpen FROM MarketSchedule WHERE `Date` BETWEEN ? AND ?",
            [`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`]
        );
        const overrides = {};
        for (const r of rows) overrides[r.d] = market.readOpenFlag(r.IsOpen);

        const days = [];
        for (let d = 1; d <= lastDay; d++) {
            const date = `${month}-${String(d).padStart(2, '0')}`;
            days.push({ date, ...market.dayStatus(date, overrides[date]) });
        }
        res.json({ month, days });
    } catch (err) {
        console.error('[market schedule get]', err);
        res.status(500).json({ error: 'Database error while loading the schedule' });
    }
});

// POST /api/admin/market/schedule { date: '2026-11-26', open: false }   (admin)
router.post('/admin/market/schedule', requireAdmin, async (req, res) => {
    const body = req.body || {};
    const date = String(body.date || '');
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        return res.status(400).json({ error: 'Please pick a valid date' });
    }
    if (typeof body.open !== 'boolean') {
        return res.status(400).json({ error: 'Market status must be Open or Closed' });
    }

    try {
        await db.query(
            'INSERT INTO MarketSchedule (`Date`, IsOpen) VALUES (?, ?) ON DUPLICATE KEY UPDATE IsOpen = ?',
            [date, market.writeOpenFlag(body.open), market.writeOpenFlag(body.open)]
        );
        const status = market.dayStatus(date, body.open);
        res.json({
            message: status.open ? `Schedule saved: Market Open on ${date}` : `Schedule saved: Closed for ${status.reason} on ${date}`,
            date, ...status
        });
    } catch (err) {
        console.error('[market schedule save]', err);
        res.status(500).json({ error: 'Database error while saving the schedule' });
    }
});

module.exports = router;
