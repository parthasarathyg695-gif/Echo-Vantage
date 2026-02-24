'use strict';
const express = require('express');
const { query } = require('../db');
const { cleanQuestion } = require('../gemini');
const auth = require('../middleware/auth');
const router = express.Router();

const DEDUP_WINDOW_MS = 8000; // 8 seconds

// Helper to verify session ownership
async function verifySession(sessionId, userId) {
    const res = await query('SELECT id FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, userId]);
    return res.rows.length > 0;
}

// POST /api/questions
router.post('/', auth, async (req, res) => {
    const { session_id, transcript } = req.body;
    if (!session_id || !transcript) {
        return res.status(400).json({ error: 'session_id and transcript are required' });
    }

    // Security: Verify this session belongs to the user
    if (!await verifySession(session_id, req.user.id)) {
        return res.status(403).json({ error: 'Forbidden: Session does not belong to user' });
    }

    let cleanResult;
    try {
        // Fetch USER'S profile
        const profileRes = await query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
        const profile = profileRes.rows[0] || {};

        cleanResult = await cleanQuestion(transcript, profile);
    } catch (err) {
        return res.status(502).json({ error: 'Gemini clean failed: ' + err.message });
    }

    const { parsed } = cleanResult;
    if (parsed.incomplete) {
        return res.json({ skipped: true, reason: 'incomplete' });
    }

    const cleanedQ = parsed.clean_question || transcript;

    // Dedup check
    try {
        const dupCheck = await query(
            `SELECT id FROM questions
       WHERE session_id = $1
         AND cleaned_question = $2
         AND created_at > NOW() - INTERVAL '8 seconds'
       LIMIT 1`,
            [session_id, cleanedQ]
        );
        if (dupCheck.rows.length > 0) {
            return res.json({ skipped: true, reason: 'duplicate', question_id: dupCheck.rows[0].id });
        }
    } catch (err) {
        console.warn('Dedup check failed:', err.message);
    }

    // Store
    try {
        const result = await query(
            `INSERT INTO questions (session_id, transcript, cleaned_question)
       VALUES ($1, $2, $3) RETURNING *`,
            [session_id, transcript, cleanedQ]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/session/:id — fetch all Q&A for a session
router.get('/:id', auth, async (req, res) => {
    const { id } = req.params;

    // Security: Verify session ownership
    if (!await verifySession(id, req.user.id)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        const result = await query(
            `SELECT q.id, q.transcript, q.cleaned_question, q.created_at,
              a.id AS answer_id, a.gemini_output, a.status
       FROM questions q
       LEFT JOIN answers a ON a.question_id = q.id
       WHERE q.session_id = $1
       ORDER BY q.created_at ASC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
