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

// GET /api/tutor/summary -> { groups, students, tasks }
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const groups = await db.query(
      'SELECT COUNT(*)::int AS n FROM groups WHERE tutor_id = $1',
      [req.user.id]
    );

    // Each student counts once, even if they are in several of this tutor's groups
    const students = await db.query(
      `SELECT COUNT(DISTINCT gm.user_id)::int AS n
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       JOIN users u ON u.id = gm.user_id
       WHERE g.tutor_id = $1 AND u.role = 'student'`,
      [req.user.id]
    );

    const tasks = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM tasks t
       JOIN groups g ON g.id = t.group_id
       WHERE g.tutor_id = $1`,
      [req.user.id]
    );

    res.json({
      groups: groups.rows[0].n,
      students: students.rows[0].n,
      tasks: tasks.rows[0].n,
    });
  } catch (err) {
    console.error('tutor summary failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
