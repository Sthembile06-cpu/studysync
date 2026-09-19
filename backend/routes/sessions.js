const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// SAVE SESSION
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { study_minutes, break_minutes, cycles, sound } = req.body;
        const user_id = req.user.id;

        await db.query(
            'INSERT INTO sessions (user_id, study_minutes, break_minutes, cycles, sound) VALUES ($1, $2, $3, $4, $5)',
            [user_id, study_minutes, break_minutes, cycles, sound]
        );

        res.status(201).json({ message: 'Session saved successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET ALL SESSIONS FOR USER
router.get('/', authMiddleware, async (req, res) => {
    try {
        const user_id = req.user.id;

        const result = await db.query(
            'SELECT * FROM sessions WHERE user_id = $1 ORDER BY completed_at DESC',
            [user_id]
        );

        res.json(result.rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET SESSION STATS
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const user_id = req.user.id;

        const result = await db.query(
            `SELECT 
                COUNT(*) as total_sessions,
                SUM(study_minutes * cycles) as total_minutes
            FROM sessions WHERE user_id = $1`,
            [user_id]
        );

        res.json(result.rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE ALL SESSIONS FOR USER
router.delete('/', authMiddleware, async (req, res) => {
    try {
        const user_id = req.user.id;

        await db.query(
            'DELETE FROM sessions WHERE user_id = $1',
            [user_id]
        );

        res.json({ message: 'All sessions deleted successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;