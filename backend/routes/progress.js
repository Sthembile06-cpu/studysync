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

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayStr = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

function mostCommon(values) {
  const counts = {};
  values.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  let best = null;
  Object.keys(counts).forEach(k => { if (best === null || counts[k] > counts[best]) best = k; });
  return best;
}

// GET /api/progress/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT study_minutes * cycles AS minutes, sound,
              to_char(local_at, 'YYYY-MM-DD') AS day,
              EXTRACT(HOUR FROM local_at)::int AS hour,
              EXTRACT(ISODOW FROM local_at)::int AS dow
       FROM (
         SELECT study_minutes, cycles, sound,
                (completed_at AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}' AS local_at
         FROM sessions WHERE user_id = $1
         ORDER BY completed_at DESC LIMIT 5000
       ) s`,
      [req.user.id]
    );
    const rows = result.rows;
    const totalSessions = rows.length;
    const totalMinutes = rows.reduce((sum, r) => sum + r.minutes, 0);

    const studied = new Set(rows.map(r => r.day));
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    const today = new Date(todayStr + 'T00:00:00Z');

    // Current streak (still alive if the last session was yesterday)
    let cursor = studied.has(todayStr) ? today : addDays(today, -1);
    let currentStreak = 0;
    while (studied.has(dayStr(cursor))) {
      currentStreak++;
      cursor = addDays(cursor, -1);
    }

    // Longest streak ever
    let longestStreak = 0, run = 0, prev = null;
    for (const d of [...studied].sort()) {
      if (prev && dayStr(addDays(new Date(prev + 'T00:00:00Z'), 1)) === d) run++;
      else run = 1;
      longestStreak = Math.max(longestStreak, run);
      prev = d;
    }

    // Minutes for each day of this week, Monday to Sunday
    const monday = addDays(today, -((today.getUTCDay() || 7) - 1));
    const minutesByDay = {};
    rows.forEach(r => { minutesByDay[r.day] = (minutesByDay[r.day] || 0) + r.minutes; });
    const weekly = Array.from({ length: 7 }, (_, i) => minutesByDay[dayStr(addDays(monday, i))] || 0);

    // Best study day (most minutes overall)
    const byDow = Array(8).fill(0);
    rows.forEach(r => { byDow[r.dow] += r.minutes; });
    let bestDow = 0;
    for (let i = 1; i <= 7; i++) if (byDow[i] > byDow[bestDow]) bestDow = i;

    const bucket = (h) => h >= 5 && h < 12 ? 'Morning'
      : h >= 12 && h < 17 ? 'Afternoon'
      : h >= 17 && h < 21 ? 'Evening' : 'Night';

    res.json({
      totalSessions,
      totalMinutes,
      currentStreak,
      longestStreak,
      weekly,
      bestDay: bestDow ? DAY_NAMES[bestDow - 1] : '-',
      avgSession: totalSessions ? Math.round(totalMinutes / totalSessions) : 0,
      favouriteSound: mostCommon(rows.map(r => r.sound).filter(s => s && s !== 'None')) || 'None',
      productiveTime: totalSessions ? mostCommon(rows.map(r => bucket(r.hour))) : '-',
    });
  } catch (err) {
    console.error('stats failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/data', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    await db.query('DELETE FROM achievements WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Data cleared' });
  } catch (err) {
    console.error('clear data failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
module.exports = router;
