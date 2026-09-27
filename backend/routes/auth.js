const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// SIGN UP
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const userRole = role === 'tutor'? 'tutor' : 'student';

        const existing = await db.query(
            'SELECT * FROM users WHERE email = $1', [email]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await db.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, role',
            [name, email, hashedPassword, userRole]
        );

        const newUser = result.rows[0];

        const token = jwt.sign(
            { id: newUser.id, name, email, role: newUser.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: { id: newUser.id, name, email, role: newUser.role }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// LOG IN
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await db.query(
            'SELECT * FROM users WHERE email = $1', [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const user = result.rows[0];

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, email: user.email, role: user.role || 'student' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Logged in successfully',
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role || 'student' }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
