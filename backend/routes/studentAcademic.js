const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ---------- one-time setup: the student academic info table ----------
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS student_academic_info (
          user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          university TEXT,
          faculty TEXT,
          school TEXT,
          course TEXT,
          academic_year TEXT,
          modules TEXT[] NOT NULL DEFAULT '{}',
          carry_over_modules TEXT[] NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      .catch((err) => { tableReady = null; throw err; }); // retry on the next request if it failed
  }
  return tableReady;
}
ensureTable().catch((e) => console.error('student_academic_info setup failed:', e.message));

function ready(req, res, next) {
  ensureTable()
    .then(() => next())
    .catch((e) => {
      console.error('student_academic_info not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((v) => cleanText(v)).filter((v) => v.length > 0);
}

// GET /api/student/academic -> the logged-in student's saved academic info ({} if none yet)
router.get('/academic', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT university, faculty, school, course, academic_year, modules, carry_over_modules
       FROM student_academic_info WHERE user_id = $1`,
      [req.user.id]
    );
    res.json(r.rows[0] || {});
  } catch (e) {
    console.error('get academic info failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/student/academic
// { university, faculty, school, course, academic_year, modules: [], carry_over_modules: [] }
// Creates the row the first time, updates it after that.
router.put('/academic', auth, ready, async (req, res) => {
  const body = req.body || {};
  const university = cleanText(body.university);
  const faculty = cleanText(body.faculty);
  const school = cleanText(body.school);
  const course = cleanText(body.course);
  const academicYear = cleanText(body.academic_year, 50);
  const modules = cleanList(body.modules);
  const carryOver = cleanList(body.carry_over_modules);

  if (!university || !faculty || !school || !course) {
    return res.status(400).json({ message: 'University, faculty, school and course are required' });
  }

  try {
    await pool.query(
      `INSERT INTO student_academic_info
         (user_id, university, faculty, school, course, academic_year, modules, carry_over_modules, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         university = EXCLUDED.university,
         faculty = EXCLUDED.faculty,
         school = EXCLUDED.school,
         course = EXCLUDED.course,
         academic_year = EXCLUDED.academic_year,
         modules = EXCLUDED.modules,
         carry_over_modules = EXCLUDED.carry_over_modules,
         updated_at = NOW()`,
      [req.user.id, university, faculty, school, course, academicYear, modules, carryOver]
    );
    res.json({ message: 'Academic info saved' });
  } catch (e) {
    console.error('save academic info failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
