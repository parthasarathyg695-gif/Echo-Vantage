'use strict';
const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const auth = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'murmur-alpha-secret-shhh';

// ── Signup ──────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = await query(
            'INSERT INTO users (email, password_hash, full_name, credits) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, has_seen_onboarding',
            [email, passwordHash, fullName || null, 5]
        );

        const user = result.rows[0];
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        await query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, refreshToken, expiresAt]
        );

        res.status(201).json({ user, token, refreshToken });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Login ───────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        await query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, refreshToken, expiresAt]
        );

        delete user.password_hash;
        res.json({ user, token, refreshToken });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Refresh Token ───────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    try {
        const result = await query(
            'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
            [refreshToken]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        const userId = result.rows[0].user_id;
        const newToken = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '1h' });

        res.json({ token: newToken });
    } catch (err) {
        console.error('Refresh error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Logout ──────────────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
    const { refreshToken } = req.body;
    try {
        if (refreshToken) {
            await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Verify Token ────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
    try {
        const result = await query('SELECT id, email, full_name, credits, has_seen_onboarding FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/onboarding-complete', auth, async (req, res) => {
    try {
        await query('UPDATE users SET has_seen_onboarding = TRUE WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

const { sendResetEmail } = require('../utils/mailer');

// ── Forgot Password ─────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const result = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.json({ message: 'If an account exists, a reset link has been sent.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hour from now

        await query(
            'UPDATE users SET reset_token = $1, reset_expires = $2 WHERE email = $3',
            [token, expires, email]
        );

        await sendResetEmail(email, token);
        res.json({ message: 'Reset link sent.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Reset Password ──────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    try {
        const result = await query(
            'SELECT id FROM users WHERE reset_token = $1 AND reset_expires > NOW()',
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        const userId = result.rows[0].id;
        const passwordHash = await bcrypt.hash(password, 10);

        await query(
            'UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2',
            [passwordHash, userId]
        );

        res.json({ success: true, message: 'Password reset successful' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
