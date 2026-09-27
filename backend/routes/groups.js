const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const db = require('../config/db');

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// CREATE group
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, subject, description } = req.body;
    const tutorId = req.user.id;
    const tutorName = req.user.name || 'Tutor';

    let inviteCode;
    let exists = true;
    while (exists) {
      inviteCode = generateInviteCode();
      const check = await db.query('SELECT id FROM groups WHERE invite_code = $1', [inviteCode]);
      exists = check.rowCount > 0;
    }

    const result = await db.query(
      `INSERT INTO groups (name, subject, description, tutor, tutor_id, invite_code)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, subject, description || '', tutorName, tutorId, inviteCode]
    );

    const group = result.rows[0];

    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [group.id, tutorId]
    );

    res.status(201).json(group);
  } catch (e) {
    console.error('CREATE group failed', e);
    res.status(500).json({ error: e.message });
  }
});

// GET my groups - with member count and tutor_name alias
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*,
        g.tutor AS tutor_name,
        (SELECT COUNT(*)::int FROM group_members WHERE group_id = g.id) AS member_count
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error('GET groups failed', e);
    res.status(500).json({ error: e.message });
  }
});

// GET single group
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*,
        g.tutor AS tutor_name,
        (SELECT COUNT(*)::int FROM group_members WHERE group_id = g.id) AS member_count
       FROM groups g WHERE g.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Group not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// JOIN by invite code
router.post('/join', authenticate, async (req, res) => {
  try {
    const inviteCode = req.body.inviteCode || req.body.invite_code;
    const userId = req.user.id;

    if (!inviteCode) return res.status(400).json({ message: 'Invite code required' });

    const groupRes = await db.query(
      'SELECT * FROM groups WHERE UPPER(invite_code) = UPPER($1)',
      [inviteCode.toString().trim()]
    );

    if (groupRes.rowCount === 0) {
      return res.status(404).json({ message: 'Invalid invite code' });
    }

    const group = groupRes.rows[0];

    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [group.id, userId]
    );

    res.json(group);
  } catch (e) {
    console.error('JOIN failed', e);
    res.status(500).json({ error: e.message });
  }
});

// LEAVE group
router.post('/:id/leave', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Left group' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET members - with role
router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.role FROM users u
       JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY u.role DESC, u.name ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error('GET members failed', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE group
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM group_members WHERE group_id = $1', [req.params.id]);
    const del = await db.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted', count: del.rowCount });
  } catch (e) {
    console.error('DELETE failed', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
