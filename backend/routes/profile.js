const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'studysync_secret_123';
const TZ = 'Africa/Johannesburg';

// Adds the bio column the first time the server starts with this file
db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''`)
  .catch(e => console.error('bio column failed:', e.message));

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ message: 'Unauthorized' });
  }
}

const dayStr = (d) => d.toISOString().slice(0, 10);

// GET /api/profile
router.get('/', requireAuth, async (req, res) => {
  try {
    const userRes = await db.query(
      `SELECT name, email, role, COALESCE(bio, '') AS bio,
              EXTRACT(YEAR FROM created_at)::int AS year
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const user = userRes.rows[0];

    const sessionsRes = await db.query(
      `SELECT study_minutes * cycles AS minutes,
              to_char(local_at, 'YYYY-MM-DD') AS day,
              EXTRACT(HOUR FROM local_at)::int AS hour
       FROM (
         SELECT study_minutes, cycles,
                (completed_at AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}' AS local_at
         FROM sessions WHERE user_id = $1
         ORDER BY completed_at DESC LIMIT 5000
       ) s`,
      [req.user.id]
    );
    const rows = sessionsRes.rows;
    const totalSessions = rows.length;
    const totalMinutes = rows.reduce((sum, r) => sum + r.minutes, 0);

    // Longest streak of consecutive study days
    let longestStreak = 0, run = 0, prev = null;
    for (const d of [...new Set(rows.map(r => r.day))].sort()) {
      if (prev && dayStr(new Date(new Date(prev + 'T00:00:00Z').getTime() + 86400000)) === d) run++;
      else run = 1;
      longestStreak = Math.max(longestStreak, run);
      prev = d;
    }

    const achievements = [
      { name: 'First Session', unlocked: totalSessions >= 1 },
      { name: '7 Day Streak', unlocked: longestStreak >= 7 },
      { name: '10 Hours', unlocked: totalMinutes >= 600 },
      { name: 'Night Owl', unlocked: rows.some(r => r.hour >= 22 || r.hour < 4) },   // 10pm-4am
      { name: 'Early Bird', unlocked: rows.some(r => r.hour >= 4 && r.hour < 7) },   // 4am-7am
      { name: '50 Sessions', unlocked: totalSessions >= 50 },
    ];

    let groups = [];
    if (user.role === 'tutor') {
      const g = await db.query(
        'SELECT name FROM groups WHERE tutor_id = $1 ORDER BY created_at DESC',
        [req.user.id]
      );
      groups = g.rows.map(r => r.name);
    }

    res.json({
      name: user.name,
      email: user.email,
      role: user.role,
      bio: user.bio,
      memberSince: String(user.year),
      totalSessions,
      totalMinutes,
      longestStreak,
      achievements,
      groups,
    });
  } catch (err) {
    console.error('profile load failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/profile  { name, email, bio }
router.put('/', requireAuth, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const email = String((req.body && req.body.email) || '').trim();
  const bio = String((req.body && req.body.bio) || '').trim().slice(0, 500);

  if (!name || name.length > 100 || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid name or email' });
  }

  try {
    await db.query('UPDATE users SET name = $1, email = $2, bio = $3 WHERE id = $4', [
      name, email, bio, req.user.id,
    ]);
    res.json({ name, email, bio });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already exists' });
    console.error('profile update failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
