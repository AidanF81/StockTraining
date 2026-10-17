// Stock routes: list/search stocks, admin create stock, user portfolio.
// Tables used:
//   Stocks        (StockTicker PK, CompanyName, Volume, Price)
//   UserStockInfo (Email FK + StockTicker FK, SharesOwned)

const router = require('express').Router();
const db = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

// GET /api/stocks            -> all stocks
// GET /api/stocks?q=app      -> stocks whose ticker or company name contains "app"
router.get('/stocks', async (req, res) => {
    const q = String(req.query.q || '').trim();
    try {
        let rows;
        if (q) {
            const like = `%${q}%`;
            [rows] = await db.query(
                'SELECT * FROM Stocks WHERE StockTicker LIKE ? OR CompanyName LIKE ? ORDER BY StockTicker LIMIT 25',
                [like, like]
            );
        } else {
            [rows] = await db.query(
                'SELECT * FROM Stocks ORDER BY StockTicker'
            );
        }
        res.json({ stocks: rows });
    } catch (err) {
        console.error('[stocks list]', err);
        res.status(500).json({ error: 'Database error while loading stocks' });
    }
});

// GET /api/stocks/:ticker -> one stock
router.get('/stocks/:ticker', async (req, res) => {
    const ticker = String(req.params.ticker || '').trim().toUpperCase();
    try {
        const [rows] = await db.query(
            'SELECT * FROM Stocks WHERE StockTicker = ? LIMIT 1',
            [ticker]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Stock not found' });
        res.json({ stock: rows[0] });
    } catch (err) {
        console.error('[stock get]', err);
        res.status(500).json({ error: 'Database error while loading the stock' });
    }
});

// POST /api/admin/stocks  { companyName, ticker, volume, price }   (admin)
router.post('/admin/stocks', requireAdmin, async (req, res) => {
    const { companyName, ticker, volume, price } = req.body || {};

    const cleanTicker = String(ticker || '').trim().toUpperCase();
    const cleanName = String(companyName || '').trim();
    const volumeNum = Number(volume);
    const priceNum = Number(price);

    if (!cleanTicker || !cleanName || !volume || !price) {
        return res.status(400).json({ error: 'Please fill in all stock details' });
    }
    if (!/^[A-Z0-9.]{1,10}$/.test(cleanTicker)) {
        return res.status(400).json({ error: 'Ticker must be 1 to 10 letters or numbers' });
    }
    if (cleanName.length > 255) {
        return res.status(400).json({ error: 'Company name must be 255 characters or fewer' });
    }
    if (!Number.isInteger(volumeNum) || volumeNum < 1) {
        return res.status(400).json({ error: 'Volume must be a whole number of 1 or more' });
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
        return res.status(400).json({ error: 'Price must be greater than 0' });
    }

    try {
        await db.query(
            'INSERT INTO Stocks (StockTicker, CompanyName, Volume, Price) VALUES (?, ?, ?, ?)',
            [cleanTicker, cleanName, volumeNum, priceNum]
        );
        const [rows] = await db.query(
            'SELECT * FROM Stocks WHERE StockTicker = ?',
            [cleanTicker]
        );
        res.status(201).json({ message: `Stock ${cleanTicker} created successfully`, stock: rows[0] });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: `Ticker ${cleanTicker} already exists` });
        }
        console.error('[stock create]', err);
        res.status(500).json({ error: 'Database error while creating the stock' });
    }
});

// GET /api/portfolio -> the signed-in user's holdings joined to current prices
router.get('/portfolio', requireLogin, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.StockTicker, s.CompanyName, u.SharesOwned, s.Price,
                    (u.SharesOwned * s.Price) AS TotalValue
             FROM UserStockInfo u
             JOIN Stocks s ON s.StockTicker = u.StockTicker
             WHERE u.Email = ? AND u.SharesOwned > 0
             ORDER BY u.StockTicker`,
            [req.session.user.email]
        );
        const stockValue = rows.reduce((sum, r) => sum + Number(r.TotalValue || 0), 0);
        // Cash balance column does not exist yet (see schema_updates.sql); report 0 until it does.
        res.json({ holdings: rows, cash: 0, stockValue, totalValue: stockValue });
    } catch (err) {
        console.error('[portfolio]', err);
        res.status(500).json({ error: 'Database error while loading the portfolio' });
    }
});

module.exports = router;
