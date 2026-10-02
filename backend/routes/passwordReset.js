const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt'); // change to 'bcryptjs' if that's what your login uses
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  const email = String(req.body.email || '').trim().toLowerCase();

  // Always answer the same way so nobody can probe which emails exist.
  res.json({ message: 'If an account exists, a reset link has been sent.' });

  if (!email) return;
  try {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) return;
    const userId = String(user.id);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { error: delErr } = await supabase.from('password_resets').delete().eq('user_id', userId);
    if (delErr) throw delErr;

    const { error: insErr } = await supabase.from('password_resets').insert({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    if (insErr) throw insErr;

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

    const { data: row, error: findErr } = await supabase
      .from('password_resets')
      .select('user_id')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (findErr) throw findErr;
    if (!row) return res.status(400).json({ message: 'Invalid or expired link' });

    const hashed = await bcrypt.hash(String(password), 10);

    const { error: updErr } = await supabase
      .from('users')
      .update({ password: hashed }) // change 'password' if your column is named differently
      .eq('id', row.user_id);
    if (updErr) throw updErr;

    await supabase.from('password_resets').delete().eq('user_id', row.user_id);

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('reset-password failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
