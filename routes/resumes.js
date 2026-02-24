'use strict';
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { query } = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

// Multer config: memory storage for PDF parsing
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// GET /api/resumes - List all resumes for user
router.get('/', auth, async (req, res) => {
    try {
        const result = await query(
            'SELECT id, title, filename, created_at, is_active FROM resumes WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/resumes - Upload and parse resume
router.post('/', auth, upload.single('resume'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No resume file uploaded.' });
    }

    try {
        const parser = new PDFParse({ data: req.file.buffer });
        const data = await parser.getText();
        await parser.destroy();
        const resumeText = data.text;

        const resumeTitle = req.body?.title || req.file.originalname.replace(/\.pdf$/i, '');

        // Insert into resumes table
        const result = await query(
            'INSERT INTO resumes (user_id, title, filename, content, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, filename, created_at',
            [req.user.id, resumeTitle, req.file.originalname, resumeText, true]
        );

        // Deactivate other resumes
        await query(
            'UPDATE resumes SET is_active = FALSE WHERE user_id = $1 AND id != $2',
            [req.user.id, result.rows[0].id]
        );

        // Also update profile resume_text and extract data
        const { extractProfile } = require('../gemini');
        try {
            const profileData = await extractProfile(resumeText, '');
            if (profileData && profileData.parsed) {
                const p = profileData.parsed;
                await query(
                    `INSERT INTO profiles (user_id, resume_text, name, target_role, years_exp, tech_stack, updated_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
                     ON CONFLICT (user_id) DO UPDATE SET 
                        resume_text = EXCLUDED.resume_text, 
                        name = COALESCE(EXCLUDED.name, profiles.name),
                        target_role = COALESCE(EXCLUDED.target_role, profiles.target_role),
                        years_exp = COALESCE(EXCLUDED.years_exp, profiles.years_exp),
                        tech_stack = COALESCE(EXCLUDED.tech_stack, profiles.tech_stack),
                        updated_at = NOW()`,
                    [req.user.id, resumeText, p.name, p.target_role, p.years_exp, p.tech_stack]
                );

                // Update users table full_name if currently null or empty
                await query(
                    'UPDATE users SET full_name = $1 WHERE id = $2 AND (full_name IS NULL OR full_name = \'\')',
                    [p.name, req.user.id]
                );
            } else {
                // Fallback if extraction fails
                await query(
                    'INSERT INTO profiles (user_id, resume_text, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET resume_text = EXCLUDED.resume_text, updated_at = NOW()',
                    [req.user.id, resumeText]
                );
            }
        } catch (extractErr) {
            console.error('Profile extraction failed:', extractErr);
            // Non-blocking fallback
            await query(
                'INSERT INTO profiles (user_id, resume_text, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET resume_text = EXCLUDED.resume_text, updated_at = NOW()',
                [req.user.id, resumeText]
            );
        }

        res.json({ message: 'Resume uploaded and parsed successfully', resume: result.rows[0] });
    } catch (err) {
        console.error('Resume upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/resumes/:id - Delete a resume
router.delete('/:id', auth, async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM resumes WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Resume not found' });
        }
        res.json({ message: 'Resume deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
