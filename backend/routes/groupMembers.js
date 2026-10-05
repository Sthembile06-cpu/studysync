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

// Adds the "blocked" column to group_members (runs once)
let columnReady = null;
function ensureColumns() {
  if (!columnReady) {
    columnReady = db
      .query('ALTER TABLE group_members ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE')
      .catch((err) => { columnReady = null; throw err; });
  }
  return columnReady;
}
ensureColumns().catch((e) => console.error('blocked column failed:', e.message));
router.ensureColumns = ensureColumns; // groupLive.js uses this too

async function tutorCheck(groupId, userId) {
  const g = await db.query('SELECT tutor_id FROM groups WHERE id = $1', [groupId]);
  if (g.rows.length === 0) return { found: false };
  return { found: true, isTutor: Number(g.rows[0].tutor_id) === Number(userId) };
}

// Blocked students can't post chat messages. Everyone else falls through
// to the existing handler in routes/groups.js.
router.post('/:id/messages', requireAuth, async (req, res, next) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return next();
  try {
    await ensureColumns();
    const r = await db.query(
      'SELECT blocked FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );
    if (r.rows.length > 0 && r.rows[0].blocked) {
      return res.status(403).json({ message: 'You have been blocked from this group' });
    }
    next();
  } catch (err) {
    console.error('blocked check failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups/:id/member-info  (tutor only) -> [{ userId, sessions, blocked }]
router.get('/:id/member-info', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
  try {
    await ensureColumns();
    const t = await tutorCheck(groupId, req.user.id);
    if (!t.found) return res.status(404).json({ message: 'Group not found' });
    if (!t.isTutor) return res.status(403).json({ message: 'Only the group tutor can see this' });

    const result = await db.query(
      `SELECT gm.user_id AS "userId", gm.blocked AS blocked, COUNT(s.id)::int AS sessions
       FROM group_members gm
       LEFT JOIN sessions s ON s.user_id = gm.user_id
       WHERE gm.group_id = $1
       GROUP BY gm.user_id, gm.blocked`,
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('member-info failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/groups/:id/members/:userId/block  { blocked: true|false }  (tutor only)
router.put('/:id/members/:userId/block', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const targetId = parseInt(req.params.userId, 10);
  const blocked = req.body && req.body.blocked;
  if (!Number.isInteger(groupId) || !Number.isInteger(targetId) || typeof blocked !== 'boolean') {
    return res.status(400).json({ message: 'Invalid request' });
  }
  try {
    await ensureColumns();
    const t = await tutorCheck(groupId, req.user.id);
    if (!t.found) return res.status(404).json({ message: 'Group not found' });
    if (!t.isTutor) return res.status(403).json({ message: 'Only the group tutor can block members' });
    if (targetId === Number(req.user.id)) {
      return res.status(400).json({ message: 'You cannot block yourself' });
    }

    const result = await db.query(
      'UPDATE group_members SET blocked = $1 WHERE
