const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'studysync_secret_123';

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

// Creates the table the first time one of these routes is used
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db
      .query(`
        CREATE TABLE IF NOT EXISTS tutor_profiles (
          user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          lecturer VARCHAR(100) NOT NULL,
          modules TEXT[] NOT NULL DEFAULT '{}',
          venue VARCHAR(200) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      .catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

// GET /api/tutor/profile -> { completed, lecturer, modules, venue }
router.get('/profile', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const r = await db.query(
      'SELECT lecturer, modules, venue FROM tutor_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (r.rows.length === 0) {
      return res.json({ completed: false, lecturer: '', modules: [], venue: '' });
    }
    res.json({ completed: true, ...r.rows[0] });
  } catch (err) {
    console.error('tutor profile load failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/tutor/profile  { lecturer, modules, venue }  (tutors only)
router.put('/profile', requireAuth, async (req, res) => {
  const lecturer = String((req.body && req.body.lecturer) || '').trim();
  const venue = String((req.body && req.body.venue) || '').trim();
  const rawModules = req.body && req.body.modules;

  const modules = Array.isArray(rawModules)
    ? [...new Set(rawModules.map((m) => String(m).trim()).filter(Boolean))]
    : [];

  if (
    !lecturer || lecturer.length > 100 ||
    !venue || venue.length > 200 ||
    modules.length === 0 || modules.length > 20 ||
    modules.some((m) => m.length > 100)
  ) {
    return res.status(400).json({ message: 'Please check the details you entered' });
  }

  try {
    await ensureTable();
    const roleRes = await db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (roleRes.rows.length === 0 || roleRes.rows[0].role !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can complete this setup' });
    }

    await db.query(
      `INSERT INTO tutor_profiles (user_id, lecturer, modules, venue)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET lecturer = EXCLUDED.lecturer, modules = EXCLUDED.modules,
           venue = EXCLUDED.venue, updated_at = NOW()`,
      [req.user.id, lecturer, modules, venue]
    );
    res.json({ message: 'Setup saved' });
  } catch (err) {
    console.error('tutor profile save failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
