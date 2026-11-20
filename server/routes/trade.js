// Trade routes: buy stock, sell stock, transaction history.
// Tables used:
//   UserAccount   (Balance)
//   Stocks        (Price)
//   UserStockInfo (SharesOwned)
//   UserHistory   (one row per buy or sell)
//
// A buy or sell touches three tables, so each one runs in a database transaction.
// If any step fails everything is rolled back and nobody loses money or shares.

const router = require('express').Router();
const db = require('../db');
const market = require('../market');
const { requireLogin } = require('../middleware/auth');
const { parseShares, MAX_BALANCE_CENTS } = require('../util');
const { loadHistory, TRADE_TYPES } = require('../history');

const cents = (n) => Math.round(Number(n || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

// Used to stop a trade with a message for the user (and roll back).
class TradeError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

async function trade(req, res, side) {
    const body = req.body || {};
    const ticker = String(body.ticker || '').trim().toUpperCase();
    const shares = parseShares(body.shares);
    const email = req.session.user.email;

    if (!ticker) return res.status(400).json({ error: 'No stock selected' });
    if (shares === null) return res.status(400).json({ error: 'Enter a whole number of shares, 1 or more' });

    const conn = await (await db.getPool()).getConnection();
    try {
        await conn.beginTransaction();

        const status = await market.getStatus(conn);
        if (!status.open) {
            throw new TradeError(409, `Market is closed (${status.reason}). Hours are ${status.openingTime.slice(0, 5)} to ${status.closingTime.slice(0, 5)}.`, { market: status });
        }

        // FOR UPDATE locks the rows until we commit, so two orders at the same time cant both spend the same cash.
        const [acct] = await conn.query('SELECT Email, Balance FROM UserAccount WHERE Email = ? FOR UPDATE', [email]);
        if (!acct[0]) throw new TradeError(401, 'Please sign in first');

        const [stocks] = await conn.query('SELECT StockTicker, CompanyName, Price FROM Stocks WHERE StockTicker = ? FOR UPDATE', [ticker]);
        if (!stocks[0]) throw new TradeError(404, `Stock ${ticker} not found`);

        const [held] = await conn.query(
            'SELECT SharesOwned FROM UserStockInfo WHERE Email = ? AND StockTicker = ? FOR UPDATE',
            [acct[0].Email, ticker]
        );
        const sharesOwned = held[0] ? Number(held[0].SharesOwned) : 0;

        const priceCents = cents(stocks[0].Price);
        const totalCents = priceCents * shares;
        const previousCents = cents(acct[0].Balance);
        let newCents;
        let newSharesOwned;

        if (side === 'Buy') {
            if (totalCents > previousCents) {
                throw new TradeError(400, `Insufficient funds. This order costs $${money(totalCents)} and you have $${money(previousCents)}.`);
            }
            newCents = previousCents - totalCents;
            newSharesOwned = sharesOwned + shares;
        } else {
            if (shares > sharesOwned) {
                throw new TradeError(400, sharesOwned === 0
                    ? `You do not own any shares of ${ticker}`
                    : `You only own ${sharesOwned} share${sharesOwned === 1 ? '' : 's'} of ${ticker}`);
            }
            newCents = previousCents + totalCents;
            if (newCents > MAX_BALANCE_CENTS) throw new TradeError(400, 'This sale would put the cash balance over the account limit');
            newSharesOwned = sharesOwned - shares;
        }

        await conn.query('UPDATE UserAccount SET Balance = ? WHERE Email = ?', [money(newCents), acct[0].Email]);

        if (newSharesOwned === 0) {
            await conn.query('DELETE FROM UserStockInfo WHERE Email = ? AND StockTicker = ?', [acct[0].Email, ticker]);
        } else if (held[0]) {
            await conn.query('UPDATE UserStockInfo SET SharesOwned = ? WHERE Email = ? AND StockTicker = ?', [newSharesOwned, acct[0].Email, ticker]);
        } else {
            await conn.query('INSERT INTO UserStockInfo (Email, StockTicker, SharesOwned) VALUES (?, ?, ?)', [acct[0].Email, ticker, newSharesOwned]);
        }

        await conn.query(
            'INSERT INTO UserHistory (TransactionType, StockTicker, Shares, Email, PreviousBalance, NewBalance) VALUES (?, ?, ?, ?, ?, ?)',
            [side, ticker, shares, acct[0].Email, money(previousCents), money(newCents)]
        );

        await conn.commit();
        res.json({
            message: side === 'Buy'
                ? `Order complete: bought ${shares} ${ticker} at $${money(priceCents)}`
                : `Sale complete: sold ${shares} ${ticker} at $${money(priceCents)}`,
            ticker,
            shares,
            pricePerShare: priceCents / 100,
            total: totalCents / 100,
            balance: newCents / 100,
            sharesOwned: newSharesOwned
        });
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err instanceof TradeError) return res.status(err.status).json({ error: err.message, ...err.extra });
        console.error(`[${side.toLowerCase()}]`, err);
        res.status(500).json({ error: `Database error while placing the ${side.toLowerCase()} order` });
    } finally {
        conn.release();
    }
}

// POST /api/buy  { ticker, shares } -> { message, pricePerShare, total, balance, sharesOwned }
router.post('/buy', requireLogin, (req, res) => trade(req, res, 'Buy'));

// POST /api/sell { ticker, shares } -> same shape as buy
router.post('/sell', requireLogin, (req, res) => trade(req, res, 'Sell'));

// GET /api/history            -> everything (buys, sells, deposits, withdrawals), newest first
// GET /api/history?type=trades -> only buys and sells
router.get('/history', requireLogin, async (req, res) => {
    try {
        const types = req.query.type === 'trades' ? TRADE_TYPES : null;
        res.json({ history: await loadHistory(req.session.user.email, types) });
    } catch (err) {
        console.error('[history]', err);
        res.status(500).json({ error: 'Database error while loading transaction history' });
    }
});

module.exports = router;
