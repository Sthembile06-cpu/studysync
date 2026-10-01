const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// --- existing groups routes you have... keep them ---
// GET /api/groups, POST /api/groups etc. (don't delete)

// GET single group
router.get('/:id', auth, async (req,res)=>{
  const r = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  res.json(r.rows[0]);
});

// MEMBERS
router.get('/:id/members', auth, async (req,res)=>{
  const r = await pool.query(
    `SELECT u.id, u.name, u.role, u.email FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1`,
    [req.params.id]
  );
  res.json(r.rows);
});

// MESSAGES
router.get('/:id/messages', auth, async (req,res)=>{
  const r = await pool.query('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE group_id=$1 ORDER BY created_at ASC', [req.params.id]);
  res.json(r.rows);
});
router.post('/:id/messages', auth, async (req,res)=>{
  const { message } = req.body;
  const r = await pool.query(
    'INSERT INTO messages (group_id, sender_id, message) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, req.user.id, message]
  );
  res.status(201).json(r.rows[0]);
});

// ========= ADD THIS ==========
// TASKS
router.get('/:id/tasks', auth, async (req,res)=>{
  try{
    const r = await pool.query('SELECT * FROM tasks WHERE group_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(r.rows);
  } catch(e){
    // if table doesn't exist, return empty
    console.log(e.message);
    res.json([]);
  }
});
router.post('/:id/tasks', auth, async (req,res)=>{
  const { title, description, due_date } = req.body;
  try{
    const r = await pool.query(
      'INSERT INTO tasks (group_id, title, description, due_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.id, title, description, due_date || null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

// MATERIALS
router.get('/:id/materials', auth, async (req,res)=>{
  try{
    const r = await pool.query('SELECT * FROM materials WHERE group_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(r.rows);
  } catch(e){ res.json([]); }
});
router.post('/:id/materials', auth, async (req,res)=>{
  const { file_name, file_url } = req.body;
  const r = await pool.query(
    'INSERT INTO materials (group_id, file_name, file_url, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, file_name, file_url, req.user.id]
  );
  res.status(201).json(r.rows[0]);
});

module.exports = router;
