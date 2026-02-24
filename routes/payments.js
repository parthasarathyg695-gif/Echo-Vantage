'use strict';
const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { query } = require('../db');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Create Order ────────────────────────────────────────────────────────────
router.post('/create-order', async (req, res) => {
    const { userId, amount } = req.body; // Amount in INR

    if (!userId || !amount) {
        return res.status(400).json({ error: 'User ID and amount are required' });
    }

    try {
        const options = {
            amount: amount * 100, // Razorpay works in subunits (paise)
            currency: 'INR',
            receipt: `receipt_user_${userId}_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        // Store order in DB for verification later
        await query(
            'INSERT INTO orders (user_id, razorpay_order_id, amount, status) VALUES ($1, $2, $3, $4)',
            [userId, order.id, amount, 'pending']
        );

        res.json(order);
    } catch (err) {
        console.error('Razorpay Order Error:', err);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

// ── Verify Payment ──────────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, creditsToAdd } = req.body;

    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature === razorpay_signature) {
        try {
            // Update order status
            await query('UPDATE orders SET status = $1 WHERE razorpay_order_id = $2', ['completed', razorpay_order_id]);

            // Add credits to user
            await query('UPDATE users SET credits = credits + $1 WHERE id = $2', [creditsToAdd, userId]);

            res.json({ success: true, message: 'Payment verified and credits added' });
        } catch (err) {
            console.error('Payment Verification DB Error:', err);
            res.status(500).json({ error: 'Payment verified but failed to update balance' });
        }
    } else {
        res.status(400).json({ error: 'Invalid payment signature' });
    }
});

module.exports = router;
