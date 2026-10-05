const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ---------- one-time setup: columns, tables, and fixes for existing rows ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid mix-ups
function makeCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function setup() {
  await pool.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_code VARCHAR(12)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS groups_invite_code_idx ON groups (invite_code)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      group_id INT REFERENCES groups(id) ON DELETE CASCADE,
      sender_id INT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Groups created before invite codes existed get one now
  const missing = await pool.query('SELECT id FROM groups WHERE invite_code IS NULL');
  for (const row of missing.rows) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await pool.query('UPDATE groups SET invite_code = $1 WHERE id = $2', [makeCode(), row.id]);
        break;
      } catch (e) {
        if (e.code !== '23505') throw e; // only retry on a duplicate code
      }
    }
  }

  // Make sure every tutor is listed as a member of their own group
  await pool.query(`
    INSERT INTO group_members (group_id, user_id)
    SELECT id, tutor_id FROM groups WHERE tutor_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
}

const ready = setup().catch((e) => console.error('groups setup failed:', e.message));
router.use((req, res, next) => { ready.then(() => next()); });

// ---------- helpers ----------
// Checks the group exists and the user belongs to it (tutor counts as a member).
function groupAccess({ tutorOnly = false } = {}) {
  return async (req, res, next) => {
    const groupId = parseInt(req.params.id, 10);
    if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
    try {
      const g = await pool.query('SELECT tutor_id FROM groups WHERE id = $1', [groupId]);
      if (g.rows.length === 0) return res.status(404).json({ message: 'Group not found' });

      const isTutor = Number(g.rows[0].tutor_id) === Number(req.user.id);
      let isMember = isTutor;
      if (!isMember) {
        const m = await pool.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, req.user.id]
        );
        isMember = m.rows.length > 0;
      }
      if (tutorOnly && !isTutor) return res.status(403).json({ message: 'Only the group tutor can do this' });
      if (!isMember) return res.status(403).json({ message: 'You are not a member of this group' });

      req.groupId = groupId;
      req.isTutor = isTutor;
      next();
    } catch (e) {
      console.error('group access check failed:', e);
      res.status(500).json({ message: 'Server error' });
    }
  };
}

// ---------- list / create / join (these must come before the /:id routes) ----------

// GET /api/groups  -> groups you created (tutor) or joined (student)
router.get('/', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT g.id, g.name, g.description, g.invite_code, u.name AS tutor_name,
              (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
       FROM groups g
       LEFT JOIN users u ON u.id = g.tutor_id
       WHERE g.tutor_id = $1
          OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1)
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('list groups failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/groups  { name, description }  (tutors only)
router.post('/', auth, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const description = String((req.body && req.body.description) || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ message: 'Please enter a group name' });

  try {
    const roleRes = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (roleRes.rows.length === 0 || roleRes.rows[0].role !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can create groups' });
    }

    let group = null;
    for (let attempt = 0; attempt < 5 && !group; attempt++) {
      try {
        const r = await pool.query(
          `INSERT INTO groups (name, description, tutor_id, invite_code)
           VALUES ($1, $2, $3, $4) RETURNING id, name, description, invite_code`,
          [name, description, req.user.id, makeCode()]
        );
        group = r.rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // only retry if the code was already taken
      }
    }
    if (!group) return res.status(500).json({ message: 'Could not generate an invite code. Try again.' });

    await pool.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [group.id, req.user.id]
    );

    res.status(201).json(group);
  } catch (e) {
    console.error('create group failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/groups/join  { invite_code }
router.post('/join', auth, async (req, res) => {
  const code = String((req.body && req.body.invite_code) || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ message: 'Please enter an invite code' });

  try {
    const g = await pool.query('SELECT id, name FROM groups WHERE invite_code = $1', [code]);
    if (g.rows.length === 0) return res.status(404).json({ message: 'No group found with that code' });

    // If you are already a member this does nothing (and a blocked student stays blocked)
    await pool.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [g.rows[0].id, req.user.id]
    );
    res.json({ id: g.rows[0].id, name: g.rows[0].name });
  } catch (e) {
    console.error('join group failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// ---------- single group ----------

// GET single group
router.get('/:id', auth, groupAccess(), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM groups WHERE id = $1', [req.groupId]);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('get group failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// DELETE group (its tutor only)
router.delete('/:id', auth, groupAccess({ tutorOnly: true }), async (req, res) => {
  try {
    await pool.query('DELETE FROM groups WHERE id = $1', [req.groupId]);
    res.json({ message: 'Group deleted' });
  } catch (e) {
    console.error('delete group failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// MEMBERS
router.get('/:id/members', auth, groupAccess(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.role, u.email
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1`,
      [req.groupId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('members failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// MESSAGES
router.get('/:id/messages', auth, groupAccess(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM (
         SELECT m.*, u.name AS sender_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.group_id = $1
         ORDER BY m.created_at DESC LIMIT 500
       ) t ORDER BY created_at ASC`,
      [req.groupId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('messages failed:', e);
    res.status(500).json({ message: e.message });
  }
});

router.post('/:id/messages', auth, groupAccess(), async (req, res) => {
  const message = String((req.body && req.body.message) || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ message: 'Message is empty' });
  try {
    const r = await pool.query(
      'INSERT INTO messages (group_id, sender_id, message) VALUES ($1, $2, $3) RETURNING *',
      [req.groupId, req.user.id, message]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('send message failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// TASKS
router.get('/:id/tasks', auth, groupAccess(), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM tasks WHERE group_id = $1 ORDER BY created_at DESC', [req.groupId]);
    res.json(r.rows);
  } catch (e) {
    console.log(e.message);
    res.json([]);
  }
});

router.post('/:id/tasks', auth, groupAccess({ tutorOnly: true }), async (req, res) => {
  const { title, description, due_date } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ message: 'Please enter a task title' });
  try {
    const r = await pool.query(
      `INSERT INTO tasks (group_id, title, description, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.groupId, String(title).trim(), description || '', due_date || null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('create task failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// MATERIALS
router.get('/:id/materials', auth, groupAccess(), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM materials WHERE group_id = $1 ORDER BY created_at DESC', [req.groupId]);
    res.json(r.rows);
  } catch (e) {
    res.json([]);
  }
});

router.post('/:id/materials', auth, groupAccess(), async (req, res) => {
  const { file_name, file_url } = req.body || {};
  try {
    const r = await pool.query(
      'INSERT INTO materials (group_id, file_name, file_url, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.groupId, file_name, file_url, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('add material failed:', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
