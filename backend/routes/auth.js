const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

router.post('/signup', async (req, res) => {
  console.log('SIGNUP HIT:', req.body.email);
  try {
    let { name, email, password, role } = req.body;
    if (!email ||!password) return res.status(400).json({ message: 'Email and password required' });
    email = email.toLowerCase().trim();
    name = name?.trim() || email.split('@')[0];

    const exists = await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (exists.rowCount > 0) {
      console.log('SIGNUP EMAIL EXISTS:', email);
      return res.status(400).json({ message: 'Email already exists, please login' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
      [name, email, hashed, role || 'student']
    );
    const user = result.rows[0];
    console.log('SIGNUP SUCCESS:', user.email);
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Signup success', token, user });
  } catch (e) {
    console.error('SIGNUP CRASH', e);
    res.status(500).json({ message: 'Server error: ' + e.message });
  }
});

router.post('/login', async (req, res) => {
  console.log('LOGIN HIT:', req.body.email);
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email.toLowerCase().trim()]);
    if (result.rowCount === 0) return res.status(401).json({ message: 'Invalid email' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid password' });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login success', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    console.error('LOGIN CRASH', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
