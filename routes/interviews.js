'use strict';
const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

// POST /api/interviews — create new interview
router.post('/', auth, async (req, res) => {
    try {
        const { resumeId, type, jobDescription } = req.body;
        const result = await query(
            `INSERT INTO interviews (user_id, resume_id, type, job_description)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.user.id, resumeId || null, type || 'test', jobDescription || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/interviews — list all interviews for user
router.get('/', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT i.id, i.type, i.status, i.job_description, i.started_at, i.ended_at, i.created_at,
                    r.filename AS resume_title
             FROM interviews i
             LEFT JOIN resumes r ON r.id = i.resume_id
             WHERE i.user_id = $1
             ORDER BY i.created_at DESC
             LIMIT 50`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/interviews/:id — update interview status
router.patch('/:id', auth, async (req, res) => {
    try {
        const { status } = req.body;
        const result = await query(
            `UPDATE interviews SET status = $1, started_at = CASE WHEN $1 = 'in-progress' THEN NOW() ELSE started_at END,
             ended_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE ended_at END
             WHERE id = $2 AND user_id = $3 RETURNING *`,
            [status, req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Interview not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/interviews/:id — delete an interview
router.delete('/:id', auth, async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM interviews WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Interview not found' });
        res.json({ message: 'Interview deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
