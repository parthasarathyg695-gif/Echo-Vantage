'use strict';
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

async function sendResetEmail(email, token) {
    const resetLink = `http://localhost:5173/reset-password?token=${token}`;

    const mailOptions = {
        from: `"MurMur AI" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'MurMur AI: Reset your password',
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2 style="color: #2D8A61;">MurMur AI</h2>
                <p>Hello,</p>
                <p>You requested to reset your password. Click the button below to set a new one:</p>
                <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #2D8A61; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Reset Password</a>
                <p>If you didn't request this, you can ignore this email.</p>
                <p style="font-size: 12px; color: #999;">Link expires in 1 hour.</p>
            </div>
        `,
    };

    return transporter.sendMail(mailOptions);
}

module.exports = { sendResetEmail };
