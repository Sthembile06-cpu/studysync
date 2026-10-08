const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ---------- one-time setup: extra columns on the existing materials table ----------
let columnsReady = null;
function ensureColumns() {
  if (!columnsReady) {
    columnsReady = pool
      .query(`
        ALTER TABLE materials
          ADD COLUMN IF NOT EXISTS description TEXT,
          ADD COLUMN IF NOT EXISTS file_type VARCHAR(20)
      `)
      .catch((err) => { columnsReady = null; throw err; }); // retry on the next request if it failed
  }
  return columnsReady;
}
ensureColumns().catch((e) => console.error('materials columns setup failed:', e.message));

function ready(req, res, next) {
  ensureColumns()
    .then(() => next())
    .catch((e) => {
      console.error('materials not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

// The group must exist and the caller must belong to it (its tutor counts as a member).
async function loadAccess(req, res, next) {
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
    if (!isMember) return res.status(403).json({ message: 'You are not a member of this group' });

    req.groupId = groupId;
    req.isTutor = isTutor;
    next();
  } catch (e) {
    console.error('materials access check failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
}

function tutorOnly(req, res, next) {
  if (!req.isTutor) return res.status(403).json({ message: 'Only the group tutor can do this' });
  next();
}

const SELECT_FIELDS = `
  m.id, m.file_name, m.description, m.file_type, m.file_url, m.created_at,
  u.name AS uploaded_by_name`;

// GET /api/groups/materials/all
// Materials from every group the caller belongs to (for the Materials tab outside a group).
router.get('/materials/all', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${SELECT_FIELDS}, g.name AS group_name
       FROM materials m
       JOIN groups g ON g.id = m.group_id
       LEFT JOIN users u ON u.id = m.uploaded_by
       WHERE g.tutor_id = $1
          OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1)
       ORDER BY m.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('all materials failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups/:id/materials  (any member)
router.get('/:id/materials', auth, ready, loadAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${SELECT_FIELDS}
       FROM materials m
       LEFT JOIN users u ON u.id = m.uploaded_by
       WHERE m.group_id = $1
       ORDER BY m.created_at DESC`,
      [req.groupId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('list materials failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/groups/:id/materials  { file_name, description, file_type, file_url }  (tutor only)
router.post('/:id/materials', auth, ready, loadAccess, tutorOnly, async (req, res) => {
  const body = req.body || {};
  const fileName = String(body.file_name || '').trim().slice(0, 200);
  const description = String(body.description || '').trim().slice(0, 1000);
  const fileUrl = String(body.file_url || '').trim().slice(0, 2000);
  const fileType = ['PDF', 'Image', 'Document'].includes(body.file_type) ? body.file_type : 'Document';

  if (!fileName) return res.status(400).json({ message: 'Please enter a title' });
  if (!/^https?:\/\/\S+$/i.test(fileUrl)) {
    return res.status(400).json({ message: 'Please enter a valid link starting with http:// or https://' });
  }

  try {
    const r = await pool.query(
      `INSERT INTO materials (group_id, file_name, description, file_type, file_url, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [req.groupId, fileName, description, fileType, fileUrl, req.user.id]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    console.error('add material failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/groups/:id/materials/:materialId  (tutor only)
router.delete('/:id/materials/:materialId', auth, ready, loadAccess, tutorOnly, async (req, res) => {
  const materialId = parseInt(req.params.materialId, 10);
  if (!Number.isInteger(materialId)) return res.status(400).json({ message: 'Invalid material' });
  try {
    const r = await pool.query(
      'DELETE FROM materials WHERE id = $1 AND group_id = $2',
      [materialId, req.groupId]
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Material not found' });
    res.json({ message: 'Material removed' });
  } catch (e) {
    console.error('delete material failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
