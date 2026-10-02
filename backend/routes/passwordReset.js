const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt'); // change to 'bcryptjs' if routes/auth.js uses that
const db = require('../config/db');

const router = express.Router();

const API_URL = process.env.PUBLIC_API_URL || 'https://studysync-backend-we5u.onrender.com';

async function sendResetEmail(to, link) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'StudySync', email: process.env.MAIL_FROM },
      to: [{ email: to }],
      subject: 'Reset your StudySync password',
      htmlContent: `
        <p>We received a request to reset your StudySync password.</p>
        <p><a href="${link}">Tap here to choose a new password</a></p>
        <p>This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Email API ${res.status}: ${await res.text()}`);
}

// POST /api/auth/forgot-password  { email }
router.post('/forgot-password', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();

  // Always answer the same way so nobody can probe which emails exist.
  res.json({ message: 'If an account exists, a reset link has been sent.' });

  if (!email) return;
  try {
    const result = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
    if (result.rows.length === 0) return;
    const userId = result.rows[0].id;

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [userId, tokenHash]
    );

    await sendResetEmail(email, `${API_URL}/api/auth/reset-link?token=${token}`);
  } catch (err) {
    console.error('forgot-password failed:', err);
  }
});

// GET /api/auth/reset-link?token=...
// Email apps don't make studysync:// links clickable, so the email points here
// and this page hands off to the app.
router.get('/reset-link', (req, res) => {
  const token = encodeURIComponent(String(req.query.token || ''));
  const deepLink = `studysync://reset-password?token=${token}`;
  res.type('html').send(`<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reset your password</title>
<style>
  body{font-family:sans-serif;background:#0F172A;color:#fff;text-align:center;padding:48px 24px}
  a{display:inline-block;margin-top:24px;padding:14px 28px;background:#F59E0B;color:#000;
    border-radius:8px;text-decoration:none;font-weight:bold}
</style>
<script>window.location.href = "${deepLink}";</script>
</head><body>
  <h2>StudySync</h2>
  <p>Opening the app to reset your password...</p>
  <a href="${deepLink}">Open StudySync</a>
</body></html>`);
});

// POST /api/auth/reset-password  { token, password }
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || String(password).length < 6) {
    return res.status(400).json({ message: 'Invalid request' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');

    const found = await db.query(
      `SELECT user_id FROM password_resets
       WHERE token_hash = $1 AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    if (found.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired link' });
    }
    const userId = found.rows[0].user_id;

    const hashed = await bcrypt.hash(String(password), 10);
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('reset-password failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
