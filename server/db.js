// Database connection pool for the Stock Training System.
// Reads connection settings from server/.env (see .env.example).

const mysql = require('mysql2/promise');

const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
    console.warn(`[db] Missing settings in server/.env: ${missing.join(', ')}. Database calls will fail until these are set.`);
}

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000,
    decimalNumbers: true,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

module.exports = pool;
