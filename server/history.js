// Reads the UserHistory table for one user.
// Table used:
//   UserHistory (TransactionID, TransactionType, StockTicker, Shares, Email,
//                PreviousBalance, NewBalance, TransactionTime)
//
// TransactionType is 'Buy', 'Sell', 'Deposit' or 'Withdraw'.
// Deposits and withdrawals have no StockTicker or Shares (NULL).
// The table doesnt store a price, but for a buy or sell its just the change in cash / shares.

const db = require('./db');

const TRADE_TYPES = ['Buy', 'Sell'];
const CASH_TYPES = ['Deposit', 'Withdraw'];

const cents = (n) => Math.round(Number(n || 0) * 100);

function toEntry(row) {
    const cashChangeCents = cents(row.NewBalance) - cents(row.PreviousBalance);
    const shares = row.Shares == null ? null : Number(row.Shares);
    const isTrade = TRADE_TYPES.includes(row.TransactionType) && shares > 0;
    return {
        id: row.TransactionID,
        type: row.TransactionType,
        ticker: row.StockTicker || null,
        companyName: row.CompanyName || null,
        shares,
        pricePerShare: isTrade ? Math.abs(cashChangeCents) / shares / 100 : null,
        cashChange: cashChangeCents / 100,
        previousBalance: Number(row.PreviousBalance),
        newBalance: Number(row.NewBalance),
        // seconds since 1970 so the browser can show it in the users own time zone
        time: row.ts == null ? null : new Date(Number(row.ts) * 1000).toISOString()
    };
}

// Newest first. types = which TransactionType values to include (default all).
async function loadHistory(email, types = null, limit = 500) {
    const params = [email];
    let typeFilter = '';
    if (types && types.length) {
        typeFilter = 'AND h.TransactionType IN (?)';
        params.push(types);
    }
    params.push(limit);
    const [rows] = await db.query(
        `SELECT h.TransactionID, h.TransactionType, h.StockTicker, s.CompanyName, h.Shares,
                h.PreviousBalance, h.NewBalance, UNIX_TIMESTAMP(h.TransactionTime) AS ts
         FROM UserHistory h
         LEFT JOIN Stocks s ON s.StockTicker = h.StockTicker
         WHERE h.Email = ? ${typeFilter}
         ORDER BY h.TransactionID DESC
         LIMIT ?`,
        params
    );
    return rows.map(toEntry);
}

// Average cost per share for each stock the user still holds, worked out from their buys and sells.
// A sell takes shares out at the current average, so the average only moves on a buy.
async function averageCosts(email) {
    const [rows] = await db.query(
        `SELECT TransactionType, StockTicker, Shares, PreviousBalance, NewBalance
         FROM UserHistory
         WHERE Email = ? AND TransactionType IN (?) AND StockTicker IS NOT NULL
         ORDER BY TransactionID ASC`,
        [email, TRADE_TYPES]
    );
    const positions = {};
    for (const r of rows) {
        const shares = Number(r.Shares || 0);
        if (shares <= 0) continue;
        const p = positions[r.StockTicker] || (positions[r.StockTicker] = { shares: 0, costCents: 0 });
        if (r.TransactionType === 'Buy') {
            p.costCents += cents(r.PreviousBalance) - cents(r.NewBalance);
            p.shares += shares;
        } else {
            const sold = Math.min(shares, p.shares);
            if (p.shares > 0) p.costCents -= (p.costCents / p.shares) * sold;
            p.shares -= sold;
            if (p.shares === 0) p.costCents = 0;
        }
    }
    const result = {};
    for (const [ticker, p] of Object.entries(positions)) {
        if (p.shares > 0) result[ticker] = Math.round(p.costCents / p.shares) / 100;
    }
    return result;
}

module.exports = { TRADE_TYPES, CASH_TYPES, loadHistory, averageCosts };
