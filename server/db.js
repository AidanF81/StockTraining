// Database connection pool for the Stock Training System.
// Reads connection settings from server/.env (see .env.example).
//
// If DB_NAME is left blank, the server looks for the database that contains
// the UserAccount table and uses that, so nobody has to guess the schema name.

const mysql = require('mysql2/promise');

const SYSTEM_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys'];

const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
    console.warn(`[db] Missing settings in server/.env: ${missing.join(', ')}. Database calls will fail until these are set.`);
}

function baseConfig() {
    return {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectTimeout: 10000,
        decimalNumbers: true,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    };
}

async function detectDatabaseName() {
    const conn = await mysql.createConnection(baseConfig());
    try {
        const [rows] = await conn.query(
            `SELECT DISTINCT TABLE_SCHEMA AS name
             FROM information_schema.TABLES
             WHERE LOWER(TABLE_NAME) = 'useraccount' AND TABLE_SCHEMA NOT IN (?)
             ORDER BY TABLE_SCHEMA`,
            [SYSTEM_SCHEMAS]
        );
        if (rows.length === 0) {
            throw new Error('No database with a UserAccount table was found. Set DB_NAME in server/.env.');
        }
        if (rows.length > 1) {
            console.warn(`[db] More than one database has a UserAccount table (${rows.map((r) => r.name).join(', ')}). Using "${rows[0].name}". Set DB_NAME in .env to pick a different one.`);
        }
        return rows[0].name;
    } finally {
        await conn.end();
    }
}

let resolvedName = process.env.DB_NAME || '';
let poolPromise = null;

function getPool() {
    if (!poolPromise) {
        poolPromise = (async () => {
            if (!resolvedName) {
                resolvedName = await detectDatabaseName();
                console.log(`[db] DB_NAME is blank in .env; using detected database "${resolvedName}"`);
            }
            return mysql.createPool({
                ...baseConfig(),
                database: resolvedName,
                waitForConnections: true,
                connectionLimit: 5
            });
        })().catch((err) => {
            poolPromise = null; // allow a retry on the next call
            throw err;
        });
    }
    return poolPromise;
}

module.exports = {
    // Same call shape as a mysql2 pool: const [rows] = await db.query(sql, params)
    query: async (sql, params) => (await getPool()).query(sql, params),
    getPool,
    name: () => resolvedName
};
