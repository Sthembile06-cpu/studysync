const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// How the DP is worked out (matches the app): weights add up to 100
const WEIGHTS = { test1: 25, test2: 35, practical: 20, assignments: 10, quizzes: 10 };
const AT_RISK_BELOW = 60;      // a DP under this raises an alert for the tutor
const TOPICS_TO_UNLOCK = 3;    // topics studied before a student can request an assignment

// ---------- one-time setup: new tables (nothing existing is changed) ----------
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS module_marks (
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          assessment VARCHAR(20) NOT NULL,
          mark INT NOT NULL CHECK (mark >= 0 AND mark <= 100),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (user_id, module, assessment)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS module_topics_done (
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          topic TEXT NOT NULL,
          done_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (user_id, module, topic)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS dp_alerts (
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          dp INT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (user_id, module)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS assignment_requests (
          id SERIAL PRIMARY KEY,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS assignment_requests_one_pending_idx
        ON assignment_requests (user_id, module) WHERE status = 'pending'`);
    })().catch((err) => { tablesReady = null; throw err; }); // retry on the next request if it failed
  }
  return tablesReady;
}
ensureTables().catch((e) => console.error('module tables setup failed:', e.message));

function ready(req, res, next) {
  ensureTables()
    .then(() => next())
    .catch((e) => {
      console.error('module tables not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

// ---------- helpers ----------
function dpFrom(marks) {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) total += (Number(marks[key]) || 0) * weight;
  return Math.floor(total / 100);
}

function cleanModule(value) {
  return String(value == null ? '' : value).trim().slice(0, 200);
}

// A student can only track modules they chose (or carry over) on their profile.
async function ownsModule(userId, module) {
  if (!module) return false;
  const r = await pool.query(
    `SELECT 1 FROM student_academic_info
     WHERE user_id = $1 AND ($2 = ANY(modules) OR $2 = ANY(carry_over_modules))`,
    [userId, module]
  );
  return r.rows.length > 0;
}

// Every student who belongs to one of the calling tutor's groups
const TUTOR_STUDENT_IDS = `
  SELECT DISTINCT gm.user_id
  FROM group_members gm
  JOIN groups g ON g.id = gm.group_id
  WHERE g.tutor_id = $1 AND gm.user_id <> g.tutor_id`;

// ---------- student routes ----------

// GET /api/modules -> the student's modules with DP and progress
router.get('/', auth, ready, async (req, res) => {
  try {
    const uid = req.user.id;
    const info = await pool.query(
      'SELECT modules, carry_over_modules FROM student_academic_info WHERE user_id = $1',
      [uid]
    );
    if (info.rows.length === 0) return res.json([]);
    const modules = info.rows[0].modules || [];
    const carryOver = info.rows[0].carry_over_modules || [];

    const marksRes = await pool.query(
      'SELECT module, assessment, mark FROM module_marks WHERE user_id = $1',
      [uid]
    );
    const marksByModule = new Map();
    for (const row of marksRes.rows) {
      if (!marksByModule.has(row.module)) marksByModule.set(row.module, {});
      marksByModule.get(row.module)[row.assessment] = row.mark;
    }
    const topicsRes = await pool.query(
      'SELECT module, COUNT(*)::int AS n FROM module_topics_done WHERE user_id = $1 GROUP BY module',
      [uid]
    );
    const topicCounts = new Map(topicsRes.rows.map((r) => [r.module, r.n]));

    const list = [
      ...modules.map((m) => ({ module: m, carry_over: false })),
      ...carryOver.filter((m) => !modules.includes(m)).map((m) => ({ module: m, carry_over: true }))
    ].map(({ module, carry_over }) => {
      const marks = marksByModule.get(module) || {};
      return {
        module,
        carry_over,
        dp: dpFrom(marks),
        marks_entered: Object.keys(marks).length,
        topics_done: topicCounts.get(module) || 0
      };
    });
    res.json(list);
  } catch (e) {
    console.error('list modules failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/modules/detail?module=Name
router.get('/detail', auth, ready, async (req, res) => {
  const module = cleanModule(req.query.module);
  try {
    if (!(await ownsModule(req.user.id, module))) {
      return res.status(404).json({ message: 'Module not found' });
    }
    const marksRes = await pool.query(
      'SELECT assessment, mark FROM module_marks WHERE user_id = $1 AND module = $2',
      [req.user.id, module]
    );
    const marks = {};
    marksRes.rows.forEach((r) => { marks[r.assessment] = r.mark; });

    const topicsRes = await pool.query(
      'SELECT topic FROM module_topics_done WHERE user_id = $1 AND module = $2',
      [req.user.id, module]
    );
    const pending = await pool.query(
      `SELECT 1 FROM assignment_requests WHERE user_id = $1 AND module = $2 AND status = 'pending'`,
      [req.user.id, module]
    );
    const alert = await pool.query(
      'SELECT 1 FROM dp_alerts WHERE user_id = $1 AND module = $2',
      [req.user.id, module]
    );
    res.json({
      module,
      marks,
      topics_done: topicsRes.rows.map((r) => r.topic),
      assignment_pending: pending.rows.length > 0,
      alerted: alert.rows.length > 0
    });
  } catch (e) {
    console.error('module detail failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/modules/marks  { module, marks: { test1, test2, practical, assignments, quizzes } }
// Replaces the student's marks for that module (a missing key means "not entered").
// Raises or clears the tutor alert depending on the resulting DP.
router.put('/marks', auth, ready, async (req, res) => {
  const body = req.body || {};
  const module = cleanModule(body.module);
  const input = body.marks && typeof body.marks === 'object' ? body.marks : null;
  if (!module || !input) return res.status(400).json({ message: 'Invalid request' });

  const clean = {};
  for (const key of Object.keys(WEIGHTS)) {
    if (input[key] === undefined || input[key] === null) continue;
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return res.status(400).json({ message: 'Marks must be whole numbers from 0 to 100' });
    }
    clean[key] = n;
  }

  let client;
  try {
    if (!(await ownsModule(req.user.id, module))) {
      return res.status(404).json({ message: 'Module not found' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM module_marks WHERE user_id = $1 AND module = $2', [req.user.id, module]);
    for (const [assessment, mark] of Object.entries(clean)) {
      await client.query(
        'INSERT INTO module_marks (user_id, module, assessment, mark) VALUES ($1, $2, $3, $4)',
        [req.user.id, module, assessment, mark]
      );
    }

    const entered = Object.keys(clean).length;
    const dp = dpFrom(clean);
    const atRisk = entered > 0 && dp < AT_RISK_BELOW;
    if (atRisk) {
      await client.query(
        `INSERT INTO dp_alerts (user_id, module, dp) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, module) DO UPDATE SET dp = EXCLUDED.dp, updated_at = NOW()`,
        [req.user.id, module, dp]
      );
    } else {
      await client.query('DELETE FROM dp_alerts WHERE user_id = $1 AND module = $2', [req.user.id, module]);
    }
    await client.query('COMMIT');
    res.json({ dp, at_risk: atRisk, alerted: atRisk });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('save marks failed:', e);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/modules/topics  { module, topic, done }
router.put('/topics', auth, ready, async (req, res) => {
  const body = req.body || {};
  const module = cleanModule(body.module);
  const topic = String(body.topic == null ? '' : body.topic).trim().slice(0, 200);
  if (!module || !topic || typeof body.done !== 'boolean') {
    return res.status(400).json({ message: 'Invalid request' });
  }
  try {
    if (!(await ownsModule(req.user.id, module))) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (body.done) {
      await pool.query(
        `INSERT INTO module_topics_done (user_id, module, topic) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [req.user.id, module, topic]
      );
    } else {
      await pool.query(
        'DELETE FROM module_topics_done WHERE user_id = $1 AND module = $2 AND topic = $3',
        [req.user.id, module, topic]
      );
    }
    const c = await pool.query(
      'SELECT COUNT(*)::int AS n FROM module_topics_done WHERE user_id = $1 AND module = $2',
      [req.user.id, module]
    );
    res.json({ topics_done: c.rows[0].n });
  } catch (e) {
    console.error('save topic failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/modules/assignment-request  { module }
router.post('/assignment-request', auth, ready, async (req, res) => {
  const module = cleanModule(req.body && req.body.module);
  try {
    if (!(await ownsModule(req.user.id, module))) {
      return res.status(404).json({ message: 'Module not found' });
    }
    const c = await pool.query(
      'SELECT COUNT(*)::int AS n FROM module_topics_done WHERE user_id = $1 AND module = $2',
      [req.user.id, module]
    );
    if (c.rows[0].n < TOPICS_TO_UNLOCK) {
      return res.status(400).json({ message: `Study at least ${TOPICS_TO_UNLOCK} topics first` });
    }
    const existing = await pool.query(
      `SELECT 1 FROM assignment_requests WHERE user_id = $1 AND module = $2 AND status = 'pending'`,
      [req.user.id, module]
    );
    if (existing.rows.length === 0) {
      try {
        await pool.query('INSERT INTO assignment_requests (user_id, module) VALUES ($1, $2)', [req.user.id, module]);
      } catch (e) {
        if (e.code !== '23505') throw e; // already pending: fine
      }
    }
    res.status(201).json({ status: 'pending' });
  } catch (e) {
    console.error('assignment request failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------- tutor routes ----------

// GET /api/modules/tutor/overview
// DP alerts and pending assignment requests for the students in the calling tutor's groups.
router.get('/tutor/overview', auth, ready, async (req, res) => {
  try {
    const alerts = await pool.query(
      `SELECT a.user_id, a.module, a.dp
       FROM dp_alerts a
       WHERE a.user_id IN (${TUTOR_STUDENT_IDS})
       ORDER BY a.dp ASC`,
      [req.user.id]
    );
    const requests = await pool.query(
      `SELECT r.id, r.user_id, r.module
       FROM assignment_requests r
       WHERE r.status = 'pending' AND r.user_id IN (${TUTOR_STUDENT_IDS})
       ORDER BY r.created_at ASC`,
      [req.user.id]
    );
    res.json({ at_risk: alerts.rows, requests: requests.rows });
  } catch (e) {
    console.error('tutor overview failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/modules/tutor/assignment-requests/:id  (marks a request as handled)
router.put('/tutor/assignment-requests/:id', auth, ready, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid request' });
  try {
    const r = await pool.query(
      `UPDATE assignment_requests SET status = 'handled'
       WHERE id = $2 AND status = 'pending' AND user_id IN (${TUTOR_STUDENT_IDS})`,
      [req.user.id, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Request not found' });
    res.json({ message: 'Marked as handled' });
  } catch (e) {
    console.error('handle assignment request failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
