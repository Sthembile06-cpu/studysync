const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const router = express.Router();

// Must be the same secret routes/auth.js signs tokens with
const JWT_SECRET = process.env.JWT_SECRET || 'studysync_secret_123';
const TZ = 'Africa/Johannesburg';

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

// POST /api/progress/session  { studyMinutes, breakMinutes, cycles, sound }
router.post('/session', requireAuth, async (req, res) => {
  const { studyMinutes, breakMinutes, cycles, sound } = req.body || {};
  if (!Number.isInteger(studyMinutes) || !Number.isInteger(breakMinutes) || !Number.isInteger(cycles)) {
    return res.status(400).json({ message: 'Invalid session data' });
  }
  try {
    await db.query(
      `INSERT INTO sessions (user_id, study_minutes, break_minutes, cycles, sound)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, studyMinutes, breakMinutes, cycles, sound || null]
    );
    res.json({ message: 'Session saved' });
  } catch (err) {
    console.error('save session failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/progress/summary -> { totalSessions, totalMinutes, streak }
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const totals = await db.query(
      `SELECT COUNT(*)::int AS total_sessions,
              COALESCE(SUM(study_minutes * cycles), 0)::int AS total_minutes
       FROM sessions WHERE user_id = $1`,
      [req.user.id]
    );

    // Days with at least one session, newest first, in South African time
    const days = await db.query(
      `SELECT DISTINCT to_char(((completed_at AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day
       FROM sessions WHERE user_id = $1
       ORDER BY day DESC`,
      [req.user.id]
    );
    const studied = new Set(days.rows.map(r => r.day));

    const dayString = (d) => d.toISOString().slice(0, 10);
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
    let cursor = new Date(todayStr + 'T00:00:00Z');
    // If nothing yet today, the streak can still be alive from yesterday
    if (!studied.has(dayString(cursor))) cursor = new Date(cursor.getTime() - 86400000);

    let streak = 0;
    while (studied.has(dayString(cursor))) {
      streak++;
      cursor = new Date(cursor.getTime() - 86400000);
    }

    res.json({
      totalSessions: totals.rows[0].total_sessions,
      totalMinutes: totals.rows[0].total_minutes,
      streak,
    });
  } catch (err) {
    console.error('summary failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

const RANGES = { week: '7 days', month: '30 days' };

// GET /api/progress/history?range=all|week|month
router.get('/history', requireAuth, async (req, res) => {
  const interval = RANGES[req.query.range]; // undefined means "all"
  try {
    const result = await db.query(
      `SELECT id, study_minutes, break_minutes, cycles, sound,
              to_char((completed_at AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}', 'Mon FMDD, YYYY') AS date
       FROM sessions
       WHERE user_id = $1
       ${interval ? `AND completed_at >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '${interval}'` : ''}
       ORDER BY completed_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      date: r.date,
      studyMinutes: r.study_minutes,
      breakMinutes: r.break_minutes,
      cycles: r.cycles,
      sound: r.sound,
    })));
  } catch (err) {
    console.error('history failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
module.exports = router;
