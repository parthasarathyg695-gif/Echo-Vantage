const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const auth = require('../middleware/auth');
const { Pool } = require('pg');

const pool = new Pool();

// Configure transporter
// In a real app, use environment variables for credentials
// For this demo, we'll simulate the email sending if credentials aren't provided
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

router.post('/', auth, async (req, res) => {
    try {
        const { rating, message } = req.body;
        const userId = req.user.id; // From auth middleware

        // Fetch user info for the email
        const userRes = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'parthasarathyg693@gmail.com',
            subject: `New Feedback from MurMur AI User: ${user.email}`,
            text: `
                Rating: ${rating} / 5
                User Email: ${user.email}
                User Name: ${user.full_name || 'N/A'}
                
                Message:
                ${message}
            `,
            html: `
                <h3>New Feedback from MurMur AI</h3>
                <p><strong>Rating:</strong> ${rating} / 5</p>
                <p><strong>User Email:</strong> ${user.email}</p>
                <p><strong>User Name:</strong> ${user.full_name || 'N/A'}</p>
                <br/>
                <p><strong>Message:</strong></p>
                <p style="white-space: pre-wrap;">${message}</p>
            `
        };

        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            await transporter.sendMail(mailOptions);
            console.log('Feedback email sent');
        } else {
            console.warn('EMAIL_USER/EMAIL_PASS not set. Feedback submission logged to console only.');
            console.log('--- FEEDBACK SUBMISSION ---');
            console.log(mailOptions.text);
            console.log('---------------------------');
        }

        res.json({ message: 'Feedback received' });
    } catch (err) {
        console.error('Feedback error:', err);
        res.status(500).json({ error: 'Failed to process feedback' });
    }
});

module.exports = router;
