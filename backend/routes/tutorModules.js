const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// Same DP weights as routes/studentModules.js (rounded down)
const DP_WEIGHT_CASE = `CASE mm.assessment
  WHEN 'test1' THEN 25 WHEN 'test2' THEN 35 WHEN 'practical' THEN 20
  WHEN 'assignments' THEN 10 WHEN 'quizzes' THEN 10 ELSE 0 END`;

// ---------- one-time setup: which modules each tutor teaches (new table) ----------
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS tutor_modules (
          tutor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (tutor_id, module)
        )`)
      .catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}
ensureTable().catch((e) => console.error('tutor_modules setup failed:', e.message));

function ready(req, res, next) {
  ensureTable()
    .then(() => next())
    .catch((e) => {
      console.error('tutor_modules not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

// Only tutors may use these routes
async function tutorOnly(req, res, next) {
  try {
    const r = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (r.rows.length === 0 || r.rows[0].role !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can do this' });
    }
    next();
  } catch (e) {
    console.error('tutor check failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
}

// A student "takes" a module if it is in their modules or carry-over modules
const ENROLLED = `($1 = ANY(s.modules) OR $1 = ANY(s.carry_over_modules))`;

// GET /api/teaching/modules  -> the modules this tutor teaches, with counts
router.get('/modules', auth, ready, tutorOnly, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT tm.module,
              (SELECT COUNT(*)::int FROM student_academic_info s
                 WHERE (tm.module = ANY(s.modules) OR tm.module = ANY(s.carry_over_modules))) AS students,
              (SELECT COUNT(*)::int FROM dp_alerts a WHERE a.module = tm.module) AS at_risk,
              (SELECT COUNT(*)::int FROM assignment_requests q
                 WHERE q.module = tm.module AND q.status = 'pending') AS pending_requests
       FROM tutor_modules tm
       WHERE tm.tutor_id = $1
       ORDER BY tm.module ASC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('teaching modules failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/teaching/modules  { modules: ["Database Systems 221", ...] }  -> replaces the tutor's list
router.put('/modules', auth, ready, tutorOnly, async (req, res) => {
  const input = req.body && Array.isArray(req.body.modules) ? req.body.modules : null;
  if (!input) return res.status(400).json({ message: 'Invalid request' });
  const modules = [...new Set(input.map((m) => String(m == null ? '' : m).trim().slice(0, 200)).filter(Boolean))].slice(0, 30);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM tutor_modules WHERE tutor_id = $1', [req.user.id]);
    for (const m of modules) {
      await client.query('INSERT INTO tutor_modules (tutor_id, module) VALUES ($1, $2)', [req.user.id, m]);
    }
    await client.query('COMMIT');
    res.json({ modules });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('save teaching modules failed:', e);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/teaching/modules/detail?module=Name  -> students taking the module, and its assignment requests
// Only for a module this tutor teaches.
router.get('/modules/detail', auth, ready, tutorOnly, async (req, res) => {
  const module = String(req.query.module || '').trim().slice(0, 200);
  try {
    const mine = await pool.query('SELECT 1 FROM tutor_modules WHERE tutor_id = $1 AND module = $2', [req.user.id, module]);
    if (mine.rows.length === 0) return res.status(403).json({ message: 'You do not tutor this module' });

    const participants = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email, s.course, s.academic_year,
              (NOT ($1 = ANY(s.modules)) AND $1 = ANY(s.carry_over_modules)) AS carry_over,
              COALESCE(FLOOR(SUM(mm.mark * ${DP_WEIGHT_CASE}) / 100.0), 0)::int AS dp,
              COUNT(mm.mark)::int AS marks_entered,
              (SELECT COUNT(*)::int FROM module_topics_done t WHERE t.user_id = u.id AND t.module = $1) AS topics_done,
              EXISTS (SELECT 1 FROM dp_alerts a WHERE a.user_id = u.id AND a.module = $1) AS at_risk
       FROM student_academic_info s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN module_marks mm ON mm.user_id = u.id AND mm.module = $1
       WHERE ${ENROLLED} AND COALESCE(u.role, 'student') <> 'tutor'
       GROUP BY u.id, u.name, u.email, s.course, s.academic_year, s.modules, s.carry_over_modules
       ORDER BY at_risk DESC, dp ASC, u.name ASC`,
      [module]
    );

    const requests = await pool.query(
      `SELECT r.id, r.user_id, u.name AS student_name,
              (SELECT COUNT(*)::int FROM module_topics_done t WHERE t.user_id = r.user_id AND t.module = r.module) AS topics_done,
              (SELECT COALESCE(FLOOR(SUM(mm.mark * ${DP_WEIGHT_CASE}) / 100.0), 0)::int
                 FROM module_marks mm WHERE mm.user_id = r.user_id AND mm.module = r.module) AS dp
       FROM assignment_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'pending' AND r.module = $1
       ORDER BY r.created_at ASC`,
      [module]
    );

    res.json({ module, participants: participants.rows, requests: requests.rows });
  } catch (e) {
    console.error('teaching module detail failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
