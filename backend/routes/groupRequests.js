const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ---------- one-time setup: the join-requests table ----------
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS group_join_requests (
          id SERIAL PRIMARY KEY,
          group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'approved', 'declined')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (group_id, student_id)
        )
      `)
      .catch((err) => { tableReady = null; throw err; }); // retry on the next request if it failed
  }
  return tableReady;
}
ensureTable().catch((e) => console.error('group_join_requests setup failed:', e.message));

// Runs only on this file's own routes, so it can never break the existing group routes.
function ready(req, res, next) {
  ensureTable()
    .then(() => next())
    .catch((e) => {
      console.error('group_join_requests not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

// Looks up the group and tells us whether the caller is its tutor.
async function loadGroup(req, res, next) {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
  try {
    const g = await pool.query('SELECT tutor_id FROM groups WHERE id = $1', [groupId]);
    if (g.rows.length === 0) return res.status(404).json({ message: 'Group not found' });
    req.groupId = groupId;
    req.isTutor = Number(g.rows[0].tutor_id) === Number(req.user.id);
    next();
  } catch (e) {
    console.error('load group failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
}

function tutorOnly(req, res, next) {
  if (!req.isTutor) return res.status(403).json({ message: 'Only the group tutor can do this' });
  next();
}

// GET /api/groups/discover
// Groups the caller is not part of. invite_code is only included for the caller's OWN approved request.
router.get('/discover', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT g.id, g.name, g.description, u.name AS tutor_name,
              (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
              r.status AS request_status,
              CASE WHEN r.status = 'approved' THEN g.invite_code ELSE NULL END AS invite_code
       FROM groups g
       LEFT JOIN users u ON u.id = g.tutor_id
       LEFT JOIN group_join_requests r ON r.group_id = g.id AND r.student_id = $1
       WHERE g.tutor_id IS DISTINCT FROM $1
         AND NOT EXISTS (
           SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1
         )
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );

    // Rank: groups that match the student's modules, or already have classmates from the
    // same course, come first. If anything here fails the plain list is returned as before.
    let rows = r.rows.map((row) => ({ ...row, recommended: false }));
    try {
      const me = await pool.query(
        'SELECT course, modules FROM student_academic_info WHERE user_id = $1',
        [req.user.id]
      );
      if (me.rows.length > 0 && rows.length > 0) {
        const { course, modules } = me.rows[0];
        const classmates = new Map();
        if (course) {
          const c = await pool.query(
            `SELECT gm.group_id, COUNT(*)::int AS n
             FROM group_members gm
             JOIN student_academic_info s ON s.user_id = gm.user_id
             WHERE s.course = $1 AND gm.group_id = ANY($2::int[])
             GROUP BY gm.group_id`,
            [course, rows.map((x) => x.id)]
          );
          c.rows.forEach((x) => classmates.set(x.group_id, x.n));
        }
        const keys = (modules || []).map((m) => ({
          name: String(m).replace(/\s*\d+\s*$/, '').trim().toLowerCase(),
          code: (String(m).match(/(\d+)\s*$/) || [])[1]
        }));
        rows = rows
          .map((row, i) => {
            const text = `${row.name} ${row.description || ''}`.toLowerCase();
            const moduleHit = keys.some(
              (k) => (k.name && text.includes(k.name)) || (k.code && text.includes(k.code))
            );
            const score = (moduleHit ? 10 : 0) + Math.min(classmates.get(row.id) || 0, 9);
            return { ...row, recommended: score > 0, _score: score, _i: i };
          })
          .sort((a, b) => b._score - a._score || a._i - b._i)
          .map(({ _score, _i, ...rest }) => rest);
      }
    } catch (e) {
      console.error('discover ranking skipped:', e.message);
    }

    res.json(rows);
  } catch (e) {
    console.error('discover failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups/pending-summary
// For a tutor's home screen: which of THEIR groups have pending join requests, and how many.
router.get('/pending-summary', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT g.id AS group_id, g.name AS group_name, COUNT(r.id)::int AS pending
       FROM groups g
       JOIN group_join_requests r ON r.group_id = g.id AND r.status = 'pending'
       WHERE g.tutor_id = $1
       GROUP BY g.id, g.name
       ORDER BY pending DESC, g.name ASC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('pending summary failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/groups/:id/requests  (student asks to join; repeating it does nothing)
router.post('/:id/requests', auth, ready, loadGroup, async (req, res) => {
  try {
    if (req.isTutor) return res.status(400).json({ message: 'You already run this group' });

    const member = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [req.groupId, req.user.id]
    );
    if (member.rows.length > 0) return res.status(400).json({ message: 'You are already in this group' });

    await pool.query(
      `INSERT INTO group_join_requests (group_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, student_id) DO NOTHING`,
      [req.groupId, req.user.id]
    );
    const r = await pool.query(
      'SELECT status FROM group_join_requests WHERE group_id = $1 AND student_id = $2',
      [req.groupId, req.user.id]
    );
    res.status(201).json({ status: r.rows[0].status });
  } catch (e) {
    console.error('create join request failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups/:id/requests  (tutor only) -> pending requests
router.get('/:id/requests', auth, ready, loadGroup, tutorOnly, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.student_id, u.name AS student_name, r.created_at
       FROM group_join_requests r
       JOIN users u ON u.id = r.student_id
       WHERE r.group_id = $1 AND r.status = 'pending'
       ORDER BY r.created_at ASC`,
      [req.groupId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('list join requests failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/groups/:id/requests/:requestId  { status: 'approved' | 'declined' }  (tutor only)
router.put('/:id/requests/:requestId', auth, ready, loadGroup, tutorOnly, async (req, res) => {
  const requestId = parseInt(req.params.requestId, 10);
  const status = req.body && req.body.status;
  if (!Number.isInteger(requestId) || !['approved', 'declined'].includes(status)) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  try {
    const r = await pool.query(
      `UPDATE group_join_requests SET status = $1
       WHERE id = $2 AND group_id = $3 AND status = 'pending'`,
      [status, requestId, req.groupId]
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Request not found or already handled' });
    res.json({ message: status === 'approved' ? 'Request approved' : 'Request declined' });
  } catch (e) {
    console.error('decide join request failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
