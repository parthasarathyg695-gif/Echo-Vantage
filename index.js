'use strict';
require('./config/env').validateEnv();
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const { testConnection, query } = require('./db');
const { generateAnswer } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/answers', require('./routes/answers'));
app.use('/api/resumes', require('./routes/resumes'));
app.use('/api/interviews', require('./routes/interviews'));
app.use('/api/feedback', require('./routes/feedback'));

// Alias for session-scoped question list
app.use('/api/session', require('./routes/questions'));

// Health check
app.get('/api/health', async (req, res) => {
    try {
        await query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ status: 'error', db: err.message });
    }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────
async function start() {
    await testConnection();
    await runSchema();
    await recoverStuckJobs();

    const server = require('http').createServer(app);
    const { initSTT } = require('./stt');
    initSTT(server);

    server.listen(PORT, () => {
        console.log(`🚀  Backend listening on http://localhost:${PORT}`);
    });
}

// ── Schema Migration ──────────────────────────────────────────────────────
async function runSchema() {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    try {
        await query(sql);
        console.log('✅  Schema applied.');
    } catch (err) {
        console.error('Schema error:', err.message);
    }
}

// ── Stuck Job Recovery ────────────────────────────────────────────────────
// On restart, find any answers stuck in 'processing' and retry Gemini generation
async function recoverStuckJobs() {
    try {
        const stuck = await query(
            `SELECT a.id, a.question_id, q.cleaned_question, s.user_id
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN sessions s ON s.id = q.session_id
       WHERE a.status = 'processing'
       AND a.processing_started_at < NOW() - INTERVAL '30 seconds'`
        );

        if (stuck.rows.length === 0) return;

        console.log(`🔄  Recovering ${stuck.rows.length} stuck answer(s)...`);

        for (const row of stuck.rows) {
            setImmediate(async () => {
                try {
                    const profileResult = await query('SELECT * FROM profiles WHERE user_id = $1', [row.user_id]);
                    const profile = profileResult.rows[0] || {};
                    const { parsed, raw } = await generateAnswer(row.cleaned_question, profile);

                    await query(
                        `UPDATE answers SET gemini_output = $1, raw_response = $2, status = 'done' WHERE id = $3`,
                        [parsed.full_answer || '', raw, row.id]
                    );
                    console.log(`✅  Recovered answer ${row.id} for user ${row.user_id}`);
                } catch (err) {
                    await query(`UPDATE answers SET status = 'error' WHERE id = $1`, [row.id]).catch(() => { });
                    console.error(`❌  Failed to recover answer ${row.id}:`, err.message);
                }
            });
        }
    } catch (err) {
        console.warn('Stuck job recovery skipped:', err.message);
    }
}

start().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
