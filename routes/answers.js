'use strict';
const express = require('express');
const { query } = require('../db');
const { generateAnswer, shortenAnswer, addPersonalExample } = require('../gemini');
const auth = require('../middleware/auth');
const router = express.Router();

// Helper to verify question ownership
async function verifyQuestionOwnership(questionId, userId) {
    const res = await query(
        `SELECT q.id FROM questions q 
     JOIN sessions s ON s.id = q.session_id 
     WHERE q.id = $1 AND s.user_id = $2`,
        [questionId, userId]
    );
    return res.rows.length > 0;
}

// ── POST /api/answers ──────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
    const { question_id, cleaned_question } = req.body;
    if (!question_id || !cleaned_question) {
        return res.status(400).json({ error: 'question_id and cleaned_question are required' });
    }

    // Security check
    if (!await verifyQuestionOwnership(question_id, req.user.id)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    let answerId;
    try {
        const row = await query(
            `INSERT INTO answers (question_id, status, processing_started_at)
       VALUES ($1, 'processing', NOW()) RETURNING id`,
            [question_id]
        );
        answerId = row.rows[0].id;
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    res.json({ answer_id: answerId, status: 'processing' });

    // Async generation
    setImmediate(async () => {
        try {
            const [profileResult, interviewResult] = await Promise.all([
                query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]),
                query('SELECT job_description FROM interviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id])
            ]);
            const profile = profileResult.rows[0] || {};
            const jobDescription = interviewResult.rows[0]?.job_description || '';

            const { parsed, raw } = await generateAnswer(cleaned_question, profile, jobDescription);

            await query(
                `UPDATE answers
          SET gemini_output = $1, raw_response = $2, status = 'done'
          WHERE id = $3`,
                [parsed.full_answer || '', raw, answerId]
            );
        } catch (err) {
            console.error('Gemini answer generation failed:', err.message);
            await query(
                `UPDATE answers SET status = 'error', raw_response = $1 WHERE id = $2`,
                [err.message, answerId]
            ).catch(() => { });
        }
    });
});

// ── GET /api/answers/:id ───────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query(
            `SELECT a.id, a.question_id, a.gemini_output, a.status, a.created_at 
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN sessions s ON s.id = q.session_id
       WHERE a.id = $1 AND s.user_id = $2`,
            [id, req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Answer not found or access denied' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/answers/stream/:id ─────────────────────────────────────────────
router.get('/stream/:id', auth, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await query(
            `SELECT a.id, q.cleaned_question 
       FROM answers a 
       JOIN questions q ON q.id = a.question_id 
       JOIN sessions s ON s.id = q.session_id
       WHERE a.id = $1 AND s.user_id = $2`,
            [id, req.user.id]
        );

        if (!result.rows.length) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // SSE logic
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const { cleaned_question } = result.rows[0];
        const [profileRes, interviewRes] = await Promise.all([
            query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]),
            query('SELECT job_description FROM interviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id])
        ]);
        const profile = profileRes.rows[0] || {};
        const jobDescription = interviewRes.rows[0]?.job_description || '';

        const { streamAnswer } = require('../gemini');
        let fullText = '';

        for await (const chunk of streamAnswer(cleaned_question, profile, jobDescription)) {
            fullText += chunk;
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }

        await query(
            `UPDATE answers SET gemini_output = $1, status = 'done' WHERE id = $2`,
            [fullText, id]
        );

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        console.error('Streaming error:', err.message);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

// ── POST /api/answers/:id/shorten ─────────────────────────────────────────
router.post('/:id/shorten', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const row = await query(
            `SELECT a.gemini_output FROM answers a
       JOIN questions q ON q.id = a.question_id
       JOIN sessions s ON s.id = q.session_id
       WHERE a.id = $1 AND s.user_id = $2`,
            [id, req.user.id]
        );
        if (!row.rows.length) return res.status(404).json({ error: 'Answer not found' });

        const fullAnswer = row.rows[0].gemini_output;
        if (!fullAnswer) return res.status(400).json({ error: 'No answer to shorten' });

        const { parsed } = await shortenAnswer(fullAnswer);

        await query('UPDATE answers SET gemini_output = $1 WHERE id = $2', [
            parsed.short_version,
            id,
        ]);

        res.json({ short_version: parsed.short_version });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/answers/:id/example ─────────────────────────────────────────
router.post('/:id/example', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const [answerRow, profileRow] = await Promise.all([
            query(
                `SELECT a.gemini_output FROM answers a
         JOIN questions q ON q.id = a.question_id
         JOIN sessions s ON s.id = q.session_id
         WHERE a.id = $1 AND s.user_id = $2`,
                [id, req.user.id]
            ),
            query('SELECT projects FROM profiles WHERE user_id = $1', [req.user.id]),
        ]);

        if (!answerRow.rows.length) return res.status(404).json({ error: 'Answer not found' });

        const fullAnswer = answerRow.rows[0].gemini_output;
        const projects = profileRow.rows[0]?.projects || '';

        if (!fullAnswer) return res.status(400).json({ error: 'No answer available' });

        const { parsed } = await addPersonalExample(fullAnswer, projects);

        await query('UPDATE answers SET gemini_output = $1 WHERE id = $2', [
            parsed.augmented_answer,
            id,
        ]);

        res.json({ augmented_answer: parsed.augmented_answer });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
