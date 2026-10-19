// Cash routes: balance, deposit, withdraw.
// Table used: UserAccount.Balance
// (A CashTransaction history table is proposed in schema_updates.sql; until it exists,
//  deposits and withdrawals update the balance only.)

const router = require('express').Router();
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { parseAmount } = require('../util');

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

// POST /api/deposit { amount } -> { message, amount, balance }
router.post('/deposit', requireLogin, async (req, res) => {
    const amount = parseAmount((req.body || {}).amount);
    if (amount === null) return res.status(400).json({ error: 'Enter a valid amount' });

    const email = req.session.user.email;
    try {
        await db.query('UPDATE UserAccount SET Balance = Balance + ? WHERE Email = ?', [amount, email]);
        res.json({ message: 'Deposit complete', amount, balance: await currentBalance(email) });
    } catch (err) {
        console.error('[deposit]', err);
        res.status(500).json({ error: 'Database error while depositing' });
    }
});

// POST /api/withdraw { amount } -> { message, amount, balance }
router.post('/withdraw', requireLogin, async (req, res) => {
    const amount = parseAmount((req.body || {}).amount);
    if (amount === null) return res.status(400).json({ error: 'Enter a valid amount' });

    const email = req.session.user.email;
    try {
        // The Balance >= ? condition makes the check and the update one atomic step.
        const [result] = await db.query(
            'UPDATE UserAccount SET Balance = Balance - ? WHERE Email = ? AND Balance >= ?',
            [amount, email, amount]
        );
        if (!result || result.affectedRows === 0) {
            return res.status(400).json({ error: 'Insufficient funds', balance: await currentBalance(email) });
        }
        res.json({ message: 'Withdraw complete', amount, balance: await currentBalance(email) });
    } catch (err) {
        console.error('[withdraw]', err);
        res.status(500).json({ error: 'Database error while withdrawing' });
    }
});

module.exports = router;
