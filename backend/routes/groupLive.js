const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'studysync_secret_123';
const LIVE_HOURS = 6; // a class counts as live for 6 hours at most

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

// Adds the two columns the first time one of these routes is used
let columnsReady = null;
function ensureColumns() {
  if (!columnsReady) {
    columnsReady = db
      .query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS live_room TEXT')
      .then(() => db.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS live_started_at TIMESTAMPTZ'))
      .catch((err) => { columnsReady = null; throw err; });
  }
  return columnsReady;
}

async function getAccess(groupId, userId) {
  const g = await db.query('SELECT tutor_id FROM groups WHERE id = $1', [groupId]);
  if (g.rows.length === 0) return { found: false };
  const isTutor = Number(g.rows[0].tutor_id) === Number(userId);
  let isMember = isTutor;
  if (!isMember) {
    const m = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    isMember = m.rows.length > 0;
  }
  return { found: true, isTutor, isMember };
}

// GET /api/groups/:id/live  -> { room: "..." | null }
router.get('/:id/live', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
  try {
    await ensureColumns();
    const access = await getAccess(groupId, req.user.id);
    if (!access.found) return res.status(404).json({ message: 'Group not found' });
    if (!access.isMember) return res.status(403).json({ message: 'Not a member of this group' });

    const result = await db.query(
      `SELECT CASE WHEN live_started_at > NOW() - INTERVAL '${LIVE_HOURS} hours'
                   THEN live_room ELSE NULL END AS room
       FROM groups WHERE id = $1`,
      [groupId]
    );
    res.json({ room: result.rows[0].room || null });
  } catch (err) {
    console.error('get live failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/groups/:id/live  { room }   (tutor of the group only)
router.post('/:id/live', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const room = String((req.body && req.body.room) || '');
  if (!Number.isInteger(groupId) || !/^[a-z0-9_-]{3,100}$/.test(room)) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  try {
    await ensureColumns();
    const access = await getAccess(groupId, req.user.id);
    if (!access.found) return res.status(404).json({ message: 'Group not found' });
    if (!access.isTutor) return res.status(403).json({ message: 'Only the group tutor can start a class' });

    await db.query('UPDATE groups SET live_room = $1, live_started_at = NOW() WHERE id = $2', [room, groupId]);
    res.json({ message: 'Class started' });
  } catch (err) {
    console.error('start live failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/groups/:id/live   (tutor of the group only)
router.delete('/:id/live', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
  try {
    await ensureColumns();
    const access = await getAccess(groupId, req.user.id);
    if (!access.found) return res.status(404).json({ message: 'Group not found' });
    if (!access.isTutor) return res.status(403).json({ message: 'Only the group tutor can end a class' });

    await db.query('UPDATE groups SET live_room = NULL, live_started_at = NULL WHERE id = $1', [groupId]);
    res.json({ message: 'Class ended' });
  } catch (err) {
    console.error('end live failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
