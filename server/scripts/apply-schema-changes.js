// Adam Frazier - IFT 401 Stock Training System
// Quick script to fix a few things in the tables so I can finish buy/sell, history, and deposits.
// You can run it more than once, it checks each change first and skips it if its already done.
//
// To see what it would change (doesnt touch anything):
//   cd server && node scripts/apply-schema-changes.js
// To actually make the changes:
//   cd server && node scripts/apply-schema-changes.js --apply
//
// What it changes:
//   1. Stocks.Price goes from INT to DECIMAL(10,2) so prices can have cents
//   2. Adds Stocks.InitialPrice so we keep the price the admin set when the stock was created
//   3. UserHistory.StockTicker and Shares can be NULL, since a deposit or withdraw has no stock

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// only make changes if --apply was typed, otherwise just print what would happen
const APPLY = process.argv.includes('--apply');

(async () => {
    // same login info the server uses, comes from the .env file
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectTimeout: 10000,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });

    // DB_NAME is blank in our .env so go find the database that has the UserAccount table
    let dbName = process.env.DB_NAME;
    if (!dbName) {
        const [found] = await conn.query(
            `SELECT DISTINCT TABLE_SCHEMA AS name FROM information_schema.TABLES
             WHERE LOWER(TABLE_NAME) = 'useraccount'
               AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')`
        );
        if (found.length !== 1) throw new Error(`Expected one database with a UserAccount table, found ${found.length}. Set DB_NAME in .env.`);
        dbName = found[0].name;
    }
    await conn.query(`USE \`${dbName}\``);
    console.log(`Database: ${dbName}   Mode: ${APPLY ? 'APPLY' : 'dry run (nothing will change)'}\n`);

    // looks up one column so I can check its type and if it allows NULL
    async function column(table, name) {
        const [rows] = await conn.query(
            `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [dbName, table, name]
        );
        return rows[0] || null;
    }

    // runs one change. skips it if its not needed, and only prints the SQL on a dry run
    async function step(label, needed, statements) {
        if (!needed) { console.log(`[skip]  ${label}: already in place`); return; }
        if (!APPLY) { console.log(`[would] ${label}`); statements.forEach((s) => console.log(`          ${s}`)); return; }
        for (const s of statements) await conn.query(s);
        console.log(`[done]  ${label}`);
    }

    // print the prices first so I can make sure they are the same after
    const [before] = await conn.query('SELECT StockTicker, Price FROM Stocks ORDER BY StockTicker');
    console.log('Stock prices before:', before.map((r) => `${r.StockTicker}=${r.Price}`).join(', ') || '(no stocks)');
    console.log('');

    // 1. price needs cents
    const price = await column('Stocks', 'Price');
    await step('1. Stocks.Price to DECIMAL(10,2)',
        !price.type.toLowerCase().startsWith('decimal'),
        ['ALTER TABLE Stocks MODIFY Price DECIMAL(10,2) NOT NULL']);

    // 2. new column, then copy the current price into it for the stocks we already have
    const initial = await column('Stocks', 'InitialPrice');
    await step('2. Add Stocks.InitialPrice and fill it from the current price',
        !initial,
        ['ALTER TABLE Stocks ADD COLUMN InitialPrice DECIMAL(10,2) NULL',
         'UPDATE Stocks SET InitialPrice = Price WHERE InitialPrice IS NULL']);

    // 3. keeps the same column types, just lets them be empty
    const ticker = await column('UserHistory', 'StockTicker');
    const shares = await column('UserHistory', 'Shares');
    await step('3. UserHistory.StockTicker and Shares allow NULL',
        ticker.nullable === 'NO' || shares.nullable === 'NO',
        [`ALTER TABLE UserHistory MODIFY StockTicker ${ticker.type} NULL, MODIFY Shares ${shares.type} NULL`]);

    if (APPLY) {
        const [after] = await conn.query('SELECT StockTicker, Price, InitialPrice FROM Stocks ORDER BY StockTicker');
        console.log('\nStock prices after: ', after.map((r) => `${r.StockTicker}=${r.Price} (initial ${r.InitialPrice})`).join(', ') || '(no stocks)');
        console.log('\nFinished. Run "node scripts/inspect-db.js" to see the tables.');
    } else {
        console.log('\nNothing was changed. Run again with --apply to make the changes.');
    }
    await conn.end();
})().catch((err) => {
    // if anything fails, stop and show the error instead of continuing
    console.error('\nStopped:', err.code || '', err.sqlMessage || err.message);
    process.exit(1);
});
