// Cash routes: balance, deposit, withdraw, cash history.
// Tables used:
//   UserAccount (Balance)
//   UserHistory (one row per deposit or withdrawal, StockTicker and Shares left NULL)

const router = require('express').Router();
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { parseAmount, MAX_BALANCE_CENTS } = require('../util');
const { loadHistory, CASH_TYPES } = require('../history');

const cents = (n) => Math.round(Number(n || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

async function currentBalance(email) {
    const [rows] = await db.query('SELECT Balance FROM UserAccount WHERE Email = ? LIMIT 1', [email]);
    return rows[0] ? Number(rows[0].Balance || 0) : 0;
}

// GET /api/balance -> { balance }
router.get('/balance', requireLogin, async (req, res) => {
    try {
        res.json({ balance: await currentBalance(req.session.user.email) });
    } catch (err) {
        console.error('[balance]', err);
        res.status(500).json({ error: 'Database error while loading the balance' });
    }
});

// Deposit and withdraw do the same steps, so they share this.
// The balance change and the history row are saved together in one transaction.
async function moveCash(req, res, type) {
    const amount = parseAmount((req.body || {}).amount);
    if (amount === null) return res.status(400).json({ error: 'Enter a valid amount' });
    const amountCents = cents(amount);

    const conn = await (await db.getPool()).getConnection();
    try {
        await conn.beginTransaction();

        // FOR UPDATE locks the account row so two requests at once cant both read the old balance.
        const [acct] = await conn.query('SELECT Email, Balance FROM UserAccount WHERE Email = ? FOR UPDATE', [req.session.user.email]);
        if (!acct[0]) {
            await conn.rollback();
            return res.status(401).json({ error: 'Please sign in first' });
        }
        const previousCents = cents(acct[0].Balance);
        const newCents = type === 'Deposit' ? previousCents + amountCents : previousCents - amountCents;

        if (newCents < 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'Insufficient funds', balance: previousCents / 100 });
        }
        if (newCents > MAX_BALANCE_CENTS) {
            await conn.rollback();
            return res.status(400).json({ error: 'This deposit would put the balance over the account limit', balance: previousCents / 100 });
        }

        await conn.query('UPDATE UserAccount SET Balance = ? WHERE Email = ?', [money(newCents), acct[0].Email]);
        await conn.query(
            'INSERT INTO UserHistory (TransactionType, Email, PreviousBalance, NewBalance) VALUES (?, ?, ?, ?)',
            [type, acct[0].Email, money(previousCents), money(newCents)]
        );
        await conn.commit();

        res.json({ message: `${type} complete`, amount, balance: newCents / 100 });
    } catch (err) {
        await conn.rollback().catch(() => {});
        console.error(`[${type.toLowerCase()}]`, err);
        res.status(500).json({ error: `Database error while ${type === 'Deposit' ? 'depositing' : 'withdrawing'}` });
    } finally {
        conn.release();
    }
}

// POST /api/deposit  { amount } -> { message, amount, balance }
router.post('/deposit', requireLogin, (req, res) => moveCash(req, res, 'Deposit'));

// POST /api/withdraw { amount } -> { message, amount, balance }
router.post('/withdraw', requireLogin, (req, res) => moveCash(req, res, 'Withdraw'));

// GET /api/cash/history -> the users deposits and withdrawals, newest first
router.get('/cash/history', requireLogin, async (req, res) => {
    try {
        res.json({ history: await loadHistory(req.session.user.email, CASH_TYPES, 50) });
    } catch (err) {
        console.error('[cash history]', err);
        res.status(500).json({ error: 'Database error while loading cash transactions' });
    }
});

module.exports = router;
