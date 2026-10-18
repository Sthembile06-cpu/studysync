const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ---------- one-time setup: new tables only, nothing existing is changed ----------
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_profile_ext (
          user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          phone TEXT,
          show_phone BOOLEAN NOT NULL DEFAULT FALSE,
          avatar_url TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query('ALTER TABLE user_profile_ext ADD COLUMN IF NOT EXISTS bio TEXT');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tutor_modules (
          tutor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (tutor_id, module)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tutor_ratings (
          tutor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
          comment TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (tutor_id, student_id)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_requests (
          id SERIAL PRIMARY KEY,
          from_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          to_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
          from_read INT NOT NULL DEFAULT 0,
          to_read INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          responded_at TIMESTAMPTZ
        )`);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_requests_pair_idx
        ON chat_requests (LEAST(from_id, to_id), GREATEST(from_id, to_id))`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS direct_messages (
          id SERIAL PRIMARY KEY,
          chat_id INT NOT NULL REFERENCES chat_requests(id) ON DELETE CASCADE,
          sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
    })().catch((err) => { tablesReady = null; throw err; });
  }
  return tablesReady;
}
ensureTables().catch((e) => console.error('people tables setup failed:', e.message));

function ready(req, res, next) {
  ensureTables()
    .then(() => next())
    .catch((e) => {
      console.error('people tables not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

// ---------- file storage for profile pictures (same Supabase settings as materials) ----------
const STORAGE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/(rest|storage|auth)\/v1.*$/i, '').replace(/\/+$/, '');
const STORAGE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const BUCKET = process.env.SUPABASE_BUCKET || 'materials';
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

const storageReady = () => Boolean(STORAGE_URL && STORAGE_KEY && typeof fetch === 'function');
function storageHeaders(extra) {
  const h = { apikey: STORAGE_KEY, ...(extra || {}) };
  if (!STORAGE_KEY.startsWith('sb_')) h.Authorization = `Bearer ${STORAGE_KEY}`;
  return h;
}
function storagePathFromUrl(url) {
  const prefix = `${STORAGE_URL}/storage/v1/object/public/${BUCKET}/`;
  return url && STORAGE_URL && String(url).startsWith(prefix) ? String(url).slice(prefix.length) : null;
}
async function removeFromStorage(p) {
  if (!p || !storageReady()) return;
  try {
    await fetch(`${STORAGE_URL}/storage/v1/object/${BUCKET}/${p}`, { method: 'DELETE', headers: storageHeaders() });
  } catch (e) { console.error('storage cleanup failed:', e.message); }
}

// ---------- helpers ----------
const AVG = `(SELECT ROUND(AVG(r.rating)::numeric, 1)::float FROM tutor_ratings r WHERE r.tutor_id = u.id)`;
const CNT = `(SELECT COUNT(*)::int FROM tutor_ratings r WHERE r.tutor_id = u.id)`;

async function pairRow(a, b) {
  const r = await pool.query(
    `SELECT * FROM chat_requests
     WHERE LEAST(from_id, to_id) = LEAST($1::int, $2::int) AND GREATEST(from_id, to_id) = GREATEST($1::int, $2::int)`,
    [a, b]
  );
  return r.rows[0] || null;
}
const relation = (row, me) =>
  row ? { status: row.status, incoming: row.to_id === me, chat_id: row.id } : { status: 'none', incoming: false, chat_id: null };

// ---------- search ----------
// GET /api/people/tutors?q=  (name or module)
router.get('/tutors', auth, ready, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, e.avatar_url, e.bio,
              COALESCE((SELECT array_agg(tm.module ORDER BY tm.module) FROM tutor_modules tm WHERE tm.tutor_id = u.id), '{}') AS modules,
              ${AVG} AS avg_rating, ${CNT} AS rating_count,
              (SELECT COUNT(*)::int FROM groups g WHERE g.tutor_id = u.id) AS group_count
       FROM users u
       LEFT JOIN user_profile_ext e ON e.user_id = u.id
       WHERE u.role = 'tutor' AND u.id <> $1
         AND ($2 = '' OR u.name ILIKE '%' || $2 || '%'
              OR EXISTS (SELECT 1 FROM tutor_modules tm WHERE tm.tutor_id = u.id AND tm.module ILIKE '%' || $2 || '%'))
       ORDER BY u.name ASC
       LIMIT 50`,
      [req.user.id, q]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('search tutors failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/people/students?q=  (name or course)
router.get('/students', auth, ready, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, e.avatar_url, e.bio, s.course, s.academic_year
       FROM users u
       LEFT JOIN user_profile_ext e ON e.user_id = u.id
       LEFT JOIN student_academic_info s ON s.user_id = u.id
       WHERE COALESCE(u.role, 'student') <> 'tutor' AND u.id <> $1
         AND ($2 = '' OR u.name ILIKE '%' || $2 || '%' OR COALESCE(s.course, '') ILIKE '%' || $2 || '%')
       ORDER BY u.name ASC
       LIMIT 50`,
      [req.user.id, q]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('search students failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/people/brief?ids=1,2,3  -> short profile cards (picture, name, role, contact) for people in a chat.
// Only for tutors, people who share a group with me, and myself.
router.get('/brief', auth, ready, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Number.isInteger).slice(0, 60);
  if (ids.length === 0) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, (CASE WHEN u.role = 'tutor' THEN 'tutor' ELSE 'student' END) AS role,
              e.avatar_url, e.bio,
              (CASE WHEN u.role = 'tutor' THEN u.email ELSE NULL END) AS email,
              (CASE WHEN e.show_phone THEN e.phone ELSE NULL END) AS phone,
              s.course, s.academic_year,
              COALESCE((SELECT array_agg(tm.module ORDER BY tm.module) FROM tutor_modules tm WHERE tm.tutor_id = u.id), '{}') AS modules
       FROM users u
       LEFT JOIN user_profile_ext e ON e.user_id = u.id
       LEFT JOIN student_academic_info s ON s.user_id = u.id
       WHERE u.id = ANY($2::int[])
         AND (u.id = $1 OR u.role = 'tutor'
              OR EXISTS (SELECT 1 FROM group_members a JOIN group_members b ON b.group_id = a.group_id
                         WHERE a.user_id = $1 AND b.user_id = u.id))`,
      [req.user.id, ids]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('brief failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------- my own contact details and picture ----------
router.get('/me', auth, ready, async (req, res) => {
  try {
    const r = await pool.query('SELECT phone, show_phone, avatar_url, bio FROM user_profile_ext WHERE user_id = $1', [req.user.id]);
    res.json(r.rows[0] || { phone: null, show_phone: false, avatar_url: null, bio: null });
  } catch (e) {
    console.error('get my contact failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/people/me/bio  { bio }  ("About you" from the profile screen, shown when others search or open this profile)
router.put('/me/bio', auth, ready, async (req, res) => {
  const bio = String((req.body && req.body.bio) || '').trim().slice(0, 600);
  try {
    await pool.query(
      `INSERT INTO user_profile_ext (user_id, bio) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, updated_at = NOW()`,
      [req.user.id, bio || null]
    );
    res.json({ message: 'Saved' });
  } catch (e) {
    console.error('save bio failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/people/me  { phone, show_phone }  (the phone number is optional)
router.put('/me', auth, ready, async (req, res) => {
  const raw = String((req.body && req.body.phone) || '').trim();
  const show = Boolean(req.body && req.body.show_phone);
  if (raw && !/^[0-9+()\- ]{5,20}$/.test(raw)) {
    return res.status(400).json({ message: 'Please enter a valid phone number' });
  }
  try {
    await pool.query(
      `INSERT INTO user_profile_ext (user_id, phone, show_phone) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, show_phone = EXCLUDED.show_phone, updated_at = NOW()`,
      [req.user.id, raw || null, show && Boolean(raw)]
    );
    res.json({ message: 'Saved' });
  } catch (e) {
    console.error('save my contact failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/people/me/avatar  raw image bytes (png, jpg or webp, max 3 MB), header X-File-Name
router.post(
  '/me/avatar',
  auth, ready,
  (req, res, next) => (storageReady() ? next() : res.status(503).json({ message: 'File uploads are not set up on the server yet' })),
  express.raw({ type: () => true, limit: '3mb' }),
  async (req, res) => {
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { name = ''; }
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) return res.status(400).json({ message: 'Please choose a PNG, JPG or WEBP picture' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: 'No picture received' });

    const objectPath = `avatars/${req.user.id}-${Date.now()}.${ext}`;
    try {
      const up = await fetch(`${STORAGE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
        method: 'POST',
        headers: storageHeaders({ 'Content-Type': mime, 'x-upsert': 'false' }),
        body: req.body
      });
      if (!up.ok) {
        console.error('avatar upload failed:', up.status, await up.text());
        return res.status(502).json({ message: 'Could not store the picture' });
      }
      const url = `${STORAGE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
      const old = await pool.query('SELECT avatar_url FROM user_profile_ext WHERE user_id = $1', [req.user.id]);
      await pool.query(
        `INSERT INTO user_profile_ext (user_id, avatar_url) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`,
        [req.user.id, url]
      );
      if (old.rows.length > 0) await removeFromStorage(storagePathFromUrl(old.rows[0].avatar_url));
      res.json({ avatar_url: url });
    } catch (e) {
      console.error('save avatar failed:', e);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// ---------- public profile ----------
router.get('/profile/:id', auth, ready, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const me = req.user.id;
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid user' });
  try {
    const u = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
    if (u.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const user = u.rows[0];
    const role = user.role === 'tutor' ? 'tutor' : 'student';

    const ext = (await pool.query('SELECT phone, show_phone, avatar_url, bio FROM user_profile_ext WHERE user_id = $1', [id])).rows[0] || {};
    const out = {
      id: user.id,
      name: user.name,
      role,
      avatar_url: ext.avatar_url || null,
      bio: ext.bio || null,
      email: role === 'tutor' ? user.email : null, // tutors share their email; student emails stay private
      phone: ext.show_phone && ext.phone ? ext.phone : null,
      chat: relation(await pairRow(me, id), me)
    };

    if (role === 'tutor') {
      out.modules = (await pool.query('SELECT module FROM tutor_modules WHERE tutor_id = $1 ORDER BY module', [id])).rows.map((r) => r.module);
      out.groups = (await pool.query(
        `SELECT g.id, g.name, g.description,
                (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
         FROM groups g WHERE g.tutor_id = $1 ORDER BY g.created_at DESC`, [id])).rows;
      const rt = (await pool.query(
        `SELECT ROUND(AVG(rating)::numeric, 1)::float AS avg, COUNT(*)::int AS n FROM tutor_ratings WHERE tutor_id = $1`, [id])).rows[0];
      out.avg_rating = rt.avg;
      out.rating_count = rt.n;
      out.reviews = (await pool.query(
        `SELECT rating, comment FROM tutor_ratings WHERE tutor_id = $1 AND COALESCE(comment, '') <> ''
         ORDER BY created_at DESC LIMIT 5`, [id])).rows;
      if (id !== me) {
        const mine = await pool.query('SELECT rating FROM tutor_ratings WHERE tutor_id = $1 AND student_id = $2', [id, me]);
        out.my_rating = mine.rows[0] ? mine.rows[0].rating : null;
        // Only students who are in one of this tutor's groups can rate them
        const can = await pool.query(
          `SELECT 1 FROM groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2 WHERE g.tutor_id = $1 LIMIT 1`, [id, me]);
        out.can_rate = can.rows.length > 0;
      }
    } else {
      const s = (await pool.query('SELECT university, course, academic_year FROM student_academic_info WHERE user_id = $1', [id])).rows[0] || {};
      out.university = s.university || null;
      out.course = s.course || null;
      out.academic_year = s.academic_year || null;
    }
    res.json(out);
  } catch (e) {
    console.error('profile failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/people/tutors/:id/rating  { rating: 1-5, comment }
router.post('/tutors/:id/rating', auth, ready, async (req, res) => {
  const tutorId = parseInt(req.params.id, 10);
  const rating = parseInt(req.body && req.body.rating, 10);
  const comment = String((req.body && req.body.comment) || '').trim().slice(0, 500);
  if (!Number.isInteger(tutorId) || !(rating >= 1 && rating <= 5)) return res.status(400).json({ message: 'Choose 1 to 5 stars' });
  try {
    const t = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'tutor'`, [tutorId]);
    if (t.rows.length === 0 || tutorId === req.user.id) return res.status(404).json({ message: 'Tutor not found' });
    const can = await pool.query(
      `SELECT 1 FROM groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2 WHERE g.tutor_id = $1 LIMIT 1`,
      [tutorId, req.user.id]);
    if (can.rows.length === 0) return res.status(403).json({ message: 'You can rate a tutor once you are in one of their groups' });
    await pool.query(
      `INSERT INTO tutor_ratings (tutor_id, student_id, rating, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tutor_id, student_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = NOW()`,
      [tutorId, req.user.id, rating, comment || null]
    );
    res.json({ message: 'Thanks for your rating' });
  } catch (e) {
    console.error('rating failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------- private chats (the first message is a request the other person must accept) ----------
// GET /api/people/chats/unread -> how many new message requests and unread messages I have
router.get('/chats/unread', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM chat_requests c WHERE c.to_id = $1 AND c.status = 'pending') AS requests,
         (SELECT COUNT(*)::int FROM direct_messages m JOIN chat_requests c ON c.id = m.chat_id
            WHERE c.status = 'accepted' AND (c.from_id = $1 OR c.to_id = $1) AND m.sender_id <> $1
              AND m.id > (CASE WHEN c.from_id = $1 THEN c.from_read ELSE c.to_read END)) AS messages`,
      [req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error('unread failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/people/chats -> everything that belongs to me, newest first (declined requests are hidden)
router.get('/chats', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.status, (c.to_id = $1) AS incoming,
              u.id AS other_id, u.name AS other_name, e.avatar_url AS other_avatar, u.role AS other_role,
              lm.body AS last_body, lm.created_at AS last_at,
              (SELECT COUNT(*)::int FROM direct_messages m
                 WHERE m.chat_id = c.id AND m.sender_id <> $1
                   AND m.id > (CASE WHEN c.from_id = $1 THEN c.from_read ELSE c.to_read END)) AS unread
       FROM chat_requests c
       JOIN users u ON u.id = (CASE WHEN c.from_id = $1 THEN c.to_id ELSE c.from_id END)
       LEFT JOIN user_profile_ext e ON e.user_id = u.id
       LEFT JOIN LATERAL (SELECT body, created_at FROM direct_messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) lm ON TRUE
       WHERE (c.from_id = $1 OR c.to_id = $1) AND c.status <> 'declined'
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('list chats failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/people/chats/request  { to_id, message }
router.post('/chats/request', auth, ready, async (req, res) => {
  const me = req.user.id;
  const to = parseInt(req.body && req.body.to_id, 10);
  const message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
  if (!Number.isInteger(to) || to === me) return res.status(400).json({ message: 'Invalid request' });
  if (!message) return res.status(400).json({ message: 'Please write a message' });

  let client;
  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [to]);
    if (exists.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await pairRow(me, to);
    let chatId;
    let status = 'pending';
    if (!existing) {
      chatId = (await client.query('INSERT INTO chat_requests (from_id, to_id) VALUES ($1, $2) RETURNING id', [me, to])).rows[0].id;
    } else if (existing.status === 'accepted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'You are already chatting', chat_id: existing.id });
    } else if (existing.status === 'pending' && existing.from_id === me) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Your request is still waiting for a reply', chat_id: existing.id });
    } else if (existing.status === 'pending') {
      // They already asked me: sending a message back simply accepts it
      chatId = existing.id;
      status = 'accepted';
      await client.query(`UPDATE chat_requests SET status = 'accepted', responded_at = NOW() WHERE id = $1`, [chatId]);
    } else {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This message request was declined' });
    }
    await client.query('INSERT INTO direct_messages (chat_id, sender_id, body) VALUES ($1, $2, $3)', [chatId, me, message]);
    await client.query('COMMIT');
    res.status(201).json({ chat_id: chatId, status });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('chat request failed:', e);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/people/chats/:id/respond  { accept: true|false }  (only the person who received the request)
router.put('/chats/:id/respond', auth, ready, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const accept = req.body && req.body.accept;
  if (!Number.isInteger(id) || typeof accept !== 'boolean') return res.status(400).json({ message: 'Invalid request' });
  try {
    const r = await pool.query(
      `UPDATE chat_requests SET status = $3, responded_at = NOW()
       WHERE id = $1 AND to_id = $2 AND status = 'pending'`,
      [id, req.user.id, accept ? 'accepted' : 'declined']
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Request not found' });
    res.json({ status: accept ? 'accepted' : 'declined' });
  } catch (e) {
    console.error('respond failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/people/chats/:id/messages
router.get('/chats/:id/messages', auth, ready, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const me = req.user.id;
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid chat' });
  try {
    const c = (await pool.query('SELECT * FROM chat_requests WHERE id = $1 AND (from_id = $2 OR to_id = $2)', [id, me])).rows[0];
    if (!c || c.status === 'declined') return res.status(404).json({ message: 'Chat not found' });

    const otherId = c.from_id === me ? c.to_id : c.from_id;
    const other = (await pool.query(
      `SELECT u.id, u.name, u.role, e.avatar_url FROM users u LEFT JOIN user_profile_ext e ON e.user_id = u.id WHERE u.id = $1`,
      [otherId])).rows[0];
    const msgs = (await pool.query(
      `SELECT id, sender_id, body, created_at FROM (
         SELECT * FROM direct_messages WHERE chat_id = $1 ORDER BY id DESC LIMIT 300
       ) t ORDER BY id ASC`, [id])).rows;

    if (msgs.length > 0) {
      const col = c.from_id === me ? 'from_read' : 'to_read'; // fixed names, never user input
      await pool.query(`UPDATE chat_requests SET ${col} = GREATEST(${col}, $2) WHERE id = $1`, [id, msgs[msgs.length - 1].id]);
    }
    res.json({ me, chat: { id: c.id, status: c.status, incoming: c.to_id === me, other }, messages: msgs });
  } catch (e) {
    console.error('chat messages failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/people/chats/:id/messages  { body }  (only once the request has been accepted)
router.post('/chats/:id/messages', auth, ready, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = String((req.body && req.body.body) || '').trim().slice(0, 2000);
  if (!Number.isInteger(id) || !body) return res.status(400).json({ message: 'Message is empty' });
  try {
    const c = (await pool.query('SELECT status FROM chat_requests WHERE id = $1 AND (from_id = $2 OR to_id = $2)', [id, req.user.id])).rows[0];
    if (!c) return res.status(404).json({ message: 'Chat not found' });
    if (c.status !== 'accepted') return res.status(403).json({ message: 'You can chat once your request is accepted' });
    const r = await pool.query(
      'INSERT INTO direct_messages (chat_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id',
      [id, req.user.id, body]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    console.error('send direct message failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
