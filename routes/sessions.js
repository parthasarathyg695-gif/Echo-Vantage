'use strict';
const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

// POST /api/sessions — create new session
router.post('/', auth, async (req, res) => {
    try {
        const result = await query('INSERT INTO sessions (user_id) VALUES ($1) RETURNING *', [req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions — list all sessions (for sidebar)
router.get('/', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT s.id, s.created_at,
              COUNT(q.id)::int AS question_count
       FROM sessions s
       LEFT JOIN questions q ON q.session_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 50`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
