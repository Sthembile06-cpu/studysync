const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./config/db');

const app = express();

app.use(cors());
app.use(express.json());

// initialize database tables
async function initializeDatabase() {
    try {
        await db.query(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'student',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);
await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student'`);

        await db.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL,
                study_minutes INT NOT NULL,
                break_minutes INT NOT NULL,
                cycles INT NOT NULL,
                sound VARCHAR(50),
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS achievements (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL,
                achievement_id VARCHAR(50) NOT NULL,
                unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                tutor_id INT REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS group_members (
                group_id INT REFERENCES groups(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (group_id, user_id)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                group_id INT REFERENCES groups(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT,
                due_date DATE,
                created_by INT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS materials (
                id SERIAL PRIMARY KEY,
                group_id INT REFERENCES groups(id) ON DELETE CASCADE,
                file_name TEXT,
                file_url TEXT,
                uploaded_by INT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

                await db.query(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        console.log('Database tables ready');
    } catch (error) {
        console.error('Database initialization error:', error.message);
    }
}

initializeDatabase();

// routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));

app.get('/', (req, res) => {
    res.json({ message: 'StudySync API is running!' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
