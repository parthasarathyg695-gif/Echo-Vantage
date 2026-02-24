'use strict';
const { Pool } = require('pg');
const dns = require('dns');

// Force IPv4 — Windows DNS returns IPv6 for Supabase but the route is unreachable
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
    console.error('Unexpected DB pool error:', err.message);
});

async function query(text, params) {
    const client = await pool.connect();
    try {
        return await client.query(text, params);
    } finally {
        client.release();
    }
}

async function testConnection() {
    const res = await query('SELECT NOW() as now');
    console.log('✅  Database connected at:', res.rows[0].now);
}

module.exports = { pool, query, testConnection };
