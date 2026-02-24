'use strict';
const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

// GET /api/profile
router.get('/', auth, async (req, res) => {
    try {
        const result = await query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
        res.json(result.rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profile
router.post('/', auth, async (req, res) => {
    const { name, target_role, years_exp, tech_stack, skills, projects, resume_text, jd_text } = req.body;
    try {
        const result = await query(
            `INSERT INTO profiles (user_id, name, target_role, years_exp, tech_stack, skills, projects, resume_text, jd_text, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         target_role = EXCLUDED.target_role,
         years_exp = EXCLUDED.years_exp,
         tech_stack = EXCLUDED.tech_stack,
         skills = EXCLUDED.skills,
         projects = EXCLUDED.projects,
         resume_text = EXCLUDED.resume_text,
         jd_text = EXCLUDED.jd_text,
         updated_at = NOW()
       RETURNING *`,
            [req.user.id, name, target_role, years_exp || 0, tech_stack || [], skills || {}, projects || '', resume_text || '', jd_text || '']
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profile/extract
router.post('/extract', auth, async (req, res) => {
    const { resume, jd } = req.body;
    if (!resume || !jd) {
        return res.status(400).json({ error: 'Both resume and jd text are required.' });
    }

    try {
        const { extractProfile } = require('../gemini');
        const { parsed, raw } = await extractProfile(resume, jd);

        if (!parsed || Object.keys(parsed).length === 0) {
            return res.status(500).json({ error: 'Failed to extract valid profile from Gemini.' });
        }

        const rawYears = parsed.years_exp;
        const yearsExp = Math.floor(Number(rawYears)) || 0;

        const result = await query(
            `INSERT INTO profiles (user_id, name, target_role, years_exp, tech_stack, projects, resume_text, jd_text, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         target_role = EXCLUDED.target_role,
         years_exp = EXCLUDED.years_exp,
         tech_stack = EXCLUDED.tech_stack,
         projects = EXCLUDED.projects,
         resume_text = EXCLUDED.resume_text,
         jd_text = EXCLUDED.jd_text,
         updated_at = NOW()
       RETURNING *`,
            [req.user.id, parsed.name || '', parsed.target_role || '', yearsExp, parsed.tech_stack || [], parsed.projects || '', resume || '', jd || '']
        );

        res.json({ profile: result.rows[0], raw });
    } catch (err) {
        console.error('Profile extraction error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
