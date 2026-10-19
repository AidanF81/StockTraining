// Prints every database, table and column the server login can see.
// Useful for checking Chad's table changes and for showing the database in the demo video.
//
//   cd server && node scripts/inspect-db.js
//
// Reads DB_HOST / DB_PORT / DB_USER / DB_PASSWORD from server/.env. DB_NAME is not needed.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectTimeout: 10000,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });

    const [dbs] = await conn.query(
        `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
         ORDER BY SCHEMA_NAME`
    );

    if (dbs.length === 0) {
        console.log('Connected, but this login cannot see any user databases.');
    }

    for (const { name } of dbs) {
        console.log(`\nDatabase: ${name}`);
        const [tables] = await conn.query(
            'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
            [name]
        );
        if (tables.length === 0) console.log('  (no tables)');

        for (const t of tables) {
            const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\`.\`${t.name}\``);
            console.log(`  ${t.name}  (${n} row${n === 1 ? '' : 's'})`);
            const [cols] = await conn.query(
                `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS keyType, COLUMN_DEFAULT AS dflt
                 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
                [name, t.name]
            );
            for (const c of cols) {
                const key = c.keyType === 'PRI' ? 'PK' : c.keyType === 'MUL' ? 'FK' : '  ';
                const nn = c.nullable === 'NO' ? 'NOT NULL' : '        ';
                const d = c.dflt !== null && c.dflt !== undefined ? `default ${c.dflt}` : '';
                console.log(`      ${key} ${c.name.padEnd(18)} ${String(c.type).padEnd(16)} ${nn} ${d}`);
            }
        }
    }

    await conn.end();
})().catch((err) => {
    console.error('Could not connect:', err.code || err.message);
    if (err.code === 'ETIMEDOUT') console.error('The database is stopped, or this server\'s IP is not allowed in the RDS security group.');
    if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('Wrong DB_USER or DB_PASSWORD in server/.env.');
    process.exit(1);
});
