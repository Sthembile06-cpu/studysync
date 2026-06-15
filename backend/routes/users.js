const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// GET USER PROFILE
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const [users] = await db.execute(
            'SELECT id, name, email, created_at FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(users[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// UPDATE USER PROFILE
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const { name } = req.body;

        await db.execute(
            'UPDATE users SET name = ? WHERE id = ?',
            [name, req.user.id]
        );

        res.json({ message: 'Profile updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;