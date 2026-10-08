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

// GET /api/student/home-feed
// Upcoming tasks and recent materials from the groups the logged-in student belongs to.
router.get('/home-feed', auth, async (req, res) => {
  let tasks = [];
  let materials = [];
  try {
    const t = await pool.query(
      `SELECT t.id, t.title, g.name AS group_name, to_char(t.due_date, 'YYYY-MM-DD') AS due_date
       FROM tasks t
       JOIN groups g ON g.id = t.group_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       WHERE t.due_date IS NULL OR t.due_date >= CURRENT_DATE
       ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT 5`,
      [req.user.id]
    );
    tasks = t.rows;
  } catch (e) {
    console.error('home feed tasks failed:', e.message);
  }
  try {
    const m = await pool.query(
      `SELECT m.id, m.file_name, g.name AS group_name, m.created_at
       FROM materials m
       JOIN groups g ON g.id = m.group_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       ORDER BY m.created_at DESC
       LIMIT 5`,
      [req.user.id]
    );
    materials = m.rows;
  } catch (e) {
    console.error('home feed materials failed:', e.message);
  }
  res.json({ tasks, materials });
});

// GET /api/student/group/:id/members  (the group's tutor only)
// Course and year for each student in the group.
router.get('/group/:id/members', auth, ready, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
  try {
    const g = await pool.query('SELECT tutor_id FROM groups WHERE id = $1', [groupId]);
    if (g.rows.length === 0) return res.status(404).json({ message: 'Group not found' });
    if (Number(g.rows[0].tutor_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Only the group tutor can see this' });
    }
    const r = await pool.query(
      `SELECT gm.user_id, s.university, s.course, s.academic_year
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN student_academic_info s ON s.user_id = gm.user_id
       WHERE gm.group_id = $1 AND u.role = 'student'`,
      [groupId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('group members academic failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/student/tutor/students  (tutors only)
// Every student in any of the tutor's groups, with course, year, modules, activity and groups.
router.get('/tutor/students', auth, ready, async (req, res) => {
  try {
    const me = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (me.rows.length === 0 || me.rows[0].role !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can see this' });
    }

    const r = await pool.query(
      `SELECT u.id, u.name, u.email,
              s.university, s.course, s.academic_year, s.modules, s.carry_over_modules,
              (SELECT COUNT(*)::int FROM sessions se WHERE se.user_id = u.id) AS sessions,
              (SELECT COALESCE(SUM(se.study_minutes * se.cycles), 0)::int FROM sessions se WHERE se.user_id = u.id) AS total_minutes,
              (SELECT MAX(se.completed_at) FROM sessions se WHERE se.user_id = u.id) AS last_session,
              array_agg(DISTINCT g.name ORDER BY g.name) AS groups,
              bool_or(COALESCE(gm.blocked, FALSE)) AS blocked
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN student_academic_info s ON s.user_id = u.id
       WHERE g.tutor_id = $1 AND u.role = 'student'
       GROUP BY u.id, u.name, u.email, s.university, s.course, s.academic_year, s.modules, s.carry_over_modules
       ORDER BY u.name ASC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('tutor students failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/student/tutor/students/:userId/block  { blocked: true | false }  (tutors only)
// Blocks or unblocks the student in every group that belongs to the calling tutor.
router.put('/tutor/students/:userId/block', auth, async (req, res) => {
  const targetId = parseInt(req.params.userId, 10);
  const blocked = req.body && req.body.blocked;
  if (!Number.isInteger(targetId) || typeof blocked !== 'boolean') {
    return res.status(400).json({ message: 'Invalid request' });
  }
  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ message: 'You cannot block yourself' });
  }
  try {
    // group_members.blocked is created by routes/groupMembers.js when the server starts
    const r = await pool.query(
      `UPDATE group_members gm
       SET blocked = $1
       FROM groups g
       WHERE gm.group_id = g.id AND g.tutor_id = $2 AND gm.user_id = $3`,
      [blocked, req.user.id, targetId]
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Student not found in your groups' });
    res.json({ message: blocked ? 'Student blocked' : 'Student unblocked' });
  } catch (e) {
    console.error('block student failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
