const express = require('express');
const db = require('../config/db');
const router = express.Router();

// get all groups
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM groups ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// create group
router.post('/', async (req, res) => {
    const { name, description, tutor_id } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO groups (name, description, tutor_id) VALUES ($1, $2, $3) RETURNING *',
            [name, description, tutor_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
