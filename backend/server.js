const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./config/db');

// test database connection
db.execute('SELECT 1')
    .then(() => console.log('Database connected successfully!'))
    .catch(err => console.error('Database connection error:', err.message));
console.log('Starting server...');

const app = express();

app.use(cors());
app.use(express.json());

console.log('Loading auth routes...');
const authRoutes = require('./routes/auth');
console.log('Auth routes type:', typeof authRoutes);

console.log('Loading session routes...');
const sessionRoutes = require('./routes/sessions');
console.log('Session routes type:', typeof sessionRoutes);

console.log('Loading user routes...');
const userRoutes = require('./routes/users');
console.log('User routes type:', typeof userRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/users', userRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'StudySync API is running!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});