const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

pool.on('error', (err) => {
    console.error('Unexpected MySQL pool error:', err.code);
    // Don't crash — mysql2 will open a fresh connection on the next query
});

// Ping the pool periodically to keep at least one connection alive
setInterval(() => {
    pool.query('SELECT 1').catch(err => 
        console.error('Keepalive ping failed:', err.code)
    );
}, 60000); // every 60 seconds

module.exports = pool;