const express = require('express');
const db = require('../config/db');
const authenticate = require('../middleware/auth');
const router = express.Router();

function makeInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// get all groups
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT g.*, u.name as tutor_name,
      (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count
      FROM groups g
      LEFT JOIN users u ON u.id = g.tutor_id
      ORDER BY g.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// create group
router.post('/', authenticate, async (req, res) => {
  const { name, description } = req.body;
  const tutor_id = req.user.id;
  const invite_code = makeInviteCode();
  try {
    const result = await db.query(
      'INSERT INTO groups (name, description, tutor_id, invite_code) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, tutor_id, invite_code]
    );
    const group = result.rows[0];
    // auto-add tutor as member
    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [group.id, tutor_id]
    );
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// join by code
router.post('/join', authenticate, async (req, res) => {
  const { invite_code } = req.body;
  try {
    const g = await db.query('SELECT * FROM groups WHERE invite_code = $1', [invite_code]);
    if (g.rows.length === 0) return res.status(404).json({ error: 'Invalid code' });
    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [g.rows[0].id, req.user.id]
    );
    res.json(g.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM group_members WHERE group_id = $1', [req.params.id]);
    await db.query('DELETE FROM groups WHERE id = $1 AND tutor_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Deleted' });
  } catch(e){ res.status(500).json({error:e.message}) }
});

module.exports = router;
