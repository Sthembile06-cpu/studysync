const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ---------- one-time setup (new tables and columns only, nothing existing is changed) ----------
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_completions (
          task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          done_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (task_id, user_id)
        )`);
      await pool.query(`
        ALTER TABLE tasks
          ADD COLUMN IF NOT EXISTS attachment_url TEXT,
          ADD COLUMN IF NOT EXISTS attachment_name TEXT`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_submissions (
          task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          file_name TEXT,
          file_url TEXT,
          note TEXT,
          submitted_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (task_id, user_id)
        )`);
    })().catch((err) => { tablesReady = null; throw err; }); // retry on the next request if it failed
  }
  return tablesReady;
}
ensureTables().catch((e) => console.error('task tables setup failed:', e.message));

function ready(req, res, next) {
  ensureTables()
    .then(() => next())
    .catch((e) => {
      console.error('task tables not ready:', e.message);
      res.status(500).json({ message: 'Server error' });
    });
}

// ---------- file storage (Supabase Storage, same settings as the materials feature) ----------
const STORAGE_URL = (process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/(rest|storage|auth)\/v1.*$/i, '')
  .replace(/\/+$/, '');
const STORAGE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const BUCKET = process.env.SUPABASE_BUCKET || 'materials';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

function storageReady() {
  return Boolean(STORAGE_URL && STORAGE_KEY && typeof fetch === 'function');
}

function storageHeaders(extra) {
  const headers = { apikey: STORAGE_KEY, ...(extra || {}) };
  if (!STORAGE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${STORAGE_KEY}`;
  return headers;
}

function storagePathFromUrl(url) {
  const prefix = `${STORAGE_URL}/storage/v1/object/public/${BUCKET}/`;
  return url && STORAGE_URL && String(url).startsWith(prefix) ? String(url).slice(prefix.length) : null;
}

async function removeFromStorage(objectPath) {
  if (!objectPath || !storageReady()) return;
  try {
    await fetch(`${STORAGE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'DELETE',
      headers: storageHeaders()
    });
  } catch (e) {
    console.error('storage cleanup failed:', e.message);
  }
}

// Uploads a file and returns its public URL, or null if the storage refused it.
async function uploadToStorage(objectPath, buffer, mime) {
  const up = await fetch(`${STORAGE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': mime, 'x-upsert': 'false' }),
    body: buffer
  });
  if (!up.ok) {
    console.error('storage upload failed:', up.status, await up.text());
    return null;
  }
  return `${STORAGE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

// Values come in URL-encoded so any language fits in a header
function headerText(req, name, max) {
  try {
    return decodeURIComponent(String(req.headers[name] || '')).trim().slice(0, max);
  } catch (e) {
    return '';
  }
}

// Reads X-File-Name and checks the type. Returns { original, safeName, mime } or null.
function readFileInfo(req) {
  const original = headerText(req, 'x-file-name', 200) || 'file';
  const ext = (original.includes('.') ? original.split('.').pop() : '').toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  return { original, mime, safeName: original.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) };
}

function uniquePart() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storageGuard(req, res, next) {
  if (!storageReady()) {
    return res.status(503).json({ message: 'File uploads are not set up on the server yet' });
  }
  next();
}

// ---------- access ----------
// The group must exist and the caller must belong to it (its tutor counts as a member).
async function loadAccess(req, res, next) {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ message: 'Invalid group' });
  try {
    const g = await pool.query('SELECT tutor_id FROM groups WHERE id = $1', [groupId]);
    if (g.rows.length === 0) return res.status(404).json({ message: 'Group not found' });

    const isTutor = Number(g.rows[0].tutor_id) === Number(req.user.id);
    let isMember = isTutor;
    if (!isMember) {
      const m = await pool.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, req.user.id]
      );
      isMember = m.rows.length > 0;
    }
    if (!isMember) return res.status(403).json({ message: 'You are not a member of this group' });

    req.groupId = groupId;
    req.isTutor = isTutor;
    req.tutorId = g.rows[0].tutor_id;
    next();
  } catch (e) {
    console.error('task access check failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
}

function tutorOnly(req, res, next) {
  if (!req.isTutor) return res.status(403).json({ message: 'Only the group tutor can do this' });
  next();
}

// ---------- task lists ----------
// Tasks with the caller's own status ($1 = caller). For tutors, done_count says how many students handed in.
const SELECT_TASKS = `
  SELECT t.id, t.group_id, g.name AS group_name, t.title, t.description,
         to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
         t.attachment_url, t.attachment_name,
         (SELECT s.file_name FROM task_submissions s WHERE s.task_id = t.id AND s.user_id = $1) AS my_file_name,
         (SELECT s.file_url FROM task_submissions s WHERE s.task_id = t.id AND s.user_id = $1) AS my_file_url,
         (EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id = t.id AND c.user_id = $1)
          OR EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = t.id AND s.user_id = $1)) AS done,
         (SELECT COUNT(*)::int
            FROM (SELECT user_id FROM task_completions WHERE task_id = t.id
                  UNION
                  SELECT user_id FROM task_submissions WHERE task_id = t.id) d
            JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = d.user_id
            WHERE d.user_id <> g.tutor_id) AS done_count,
         (SELECT COUNT(*)::int FROM group_members gm
            WHERE gm.group_id = t.group_id AND gm.user_id <> g.tutor_id) AS total_students
  FROM tasks t
  JOIN groups g ON g.id = t.group_id`;
const ORDER_TASKS = 'ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC';

// GET /api/groups/tasks/all  -> tasks from every group the caller teaches or belongs to
router.get('/tasks/all', auth, ready, async (req, res) => {
  try {
    const r = await pool.query(
      `${SELECT_TASKS}
       WHERE g.tutor_id = $1
          OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1)
       ${ORDER_TASKS}
       LIMIT 200`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('all tasks failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups/:id/task-list  -> one group's tasks with status
router.get('/:id/task-list', auth, ready, loadAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `${SELECT_TASKS} WHERE t.group_id = $2 ${ORDER_TASKS}`,
      [req.user.id, req.groupId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('task list failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/groups/:id/tasks/upload  (tutor only)
// Creates a task WITH a file students can download. Raw file bytes (Content-Type: application/octet-stream);
// details in headers: X-File-Name, X-Title, X-Description, X-Due-Date (YYYY-MM-DD). Max 20 MB.
router.post(
  '/:id/tasks/upload',
  auth, ready, loadAccess, tutorOnly, storageGuard,
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req, res) => {
    const title = headerText(req, 'x-title', 200);
    const description = headerText(req, 'x-description', 1000);
    const due = headerText(req, 'x-due-date', 10);
    if (!title) return res.status(400).json({ message: 'Please enter a title' });
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ message: 'Invalid due date' });
    const info = readFileInfo(req);
    if (!info) return res.status(400).json({ message: 'That file type is not supported' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: 'No file received' });

    const objectPath = `tasks/${req.groupId}/${uniquePart()}-${info.safeName}`;
    try {
      const url = await uploadToStorage(objectPath, req.body, info.mime);
      if (!url) return res.status(502).json({ message: 'Could not store the file' });
      try {
        const r = await pool.query(
          `INSERT INTO tasks (group_id, title, description, due_date, created_by, attachment_url, attachment_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [req.groupId, title, description, due || null, req.user.id, url, info.original]
        );
        res.status(201).json({ id: r.rows[0].id });
      } catch (dbErr) {
        await removeFromStorage(objectPath);
        throw dbErr;
      }
    } catch (e) {
      console.error('create task with file failed:', e);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// POST /api/groups/:id/tasks/:taskId/submit  (a group member hands in their work)
// Raw file bytes; X-File-Name and an optional X-Note. Handing in again replaces the earlier file.
router.post(
  '/:id/tasks/:taskId/submit',
  auth, ready, loadAccess, storageGuard,
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req, res) => {
    const taskId = parseInt(req.params.taskId, 10);
    if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Invalid task' });
    if (req.isTutor) return res.status(400).json({ message: 'Tutors do not hand in tasks' });
    const info = readFileInfo(req);
    if (!info) return res.status(400).json({ message: 'That file type is not supported' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: 'No file received' });
    const note = headerText(req, 'x-note', 500);

    try {
      const t = await pool.query('SELECT 1 FROM tasks WHERE id = $1 AND group_id = $2', [taskId, req.groupId]);
      if (t.rows.length === 0) return res.status(404).json({ message: 'Task not found' });

      const objectPath = `submissions/${req.groupId}/${taskId}/${req.user.id}-${uniquePart()}-${info.safeName}`;
      const url = await uploadToStorage(objectPath, req.body, info.mime);
      if (!url) return res.status(502).json({ message: 'Could not store the file' });

      const old = await pool.query(
        'SELECT file_url FROM task_submissions WHERE task_id = $1 AND user_id = $2',
        [taskId, req.user.id]
      );
      try {
        await pool.query(
          `INSERT INTO task_submissions (task_id, user_id, file_name, file_url, note, submitted_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (task_id, user_id) DO UPDATE
             SET file_name = EXCLUDED.file_name, file_url = EXCLUDED.file_url,
                 note = EXCLUDED.note, submitted_at = NOW()`,
          [taskId, req.user.id, info.original, url, note]
        );
      } catch (dbErr) {
        await removeFromStorage(objectPath);
        throw dbErr;
      }
      if (old.rows.length > 0) await removeFromStorage(storagePathFromUrl(old.rows[0].file_url));
      res.status(201).json({ file_name: info.original, file_url: url });
    } catch (e) {
      console.error('submit task failed:', e);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// GET /api/groups/:id/tasks/:taskId/submissions  (tutor only)
// Every student in the group, with their hand-in if they made one.
router.get('/:id/tasks/:taskId/submissions', auth, ready, loadAccess, tutorOnly, async (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Invalid task' });
  try {
    const t = await pool.query('SELECT 1 FROM tasks WHERE id = $1 AND group_id = $2', [taskId, req.groupId]);
    if (t.rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const r = await pool.query(
      `SELECT u.id AS user_id, u.name, s.file_name, s.file_url, s.note, s.submitted_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN task_submissions s ON s.task_id = $2 AND s.user_id = u.id
       WHERE gm.group_id = $1 AND gm.user_id <> $3
       ORDER BY (s.submitted_at IS NULL), s.submitted_at DESC, u.name ASC`,
      [req.groupId, taskId, req.tutorId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('list submissions failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/groups/:id/tasks/:taskId/done  { done: true | false }
// Marks the caller's own status without a file (for tasks that need no hand-in).
router.put('/:id/tasks/:taskId/done', auth, ready, loadAccess, async (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  const done = req.body && req.body.done;
  if (!Number.isInteger(taskId) || typeof done !== 'boolean') {
    return res.status(400).json({ message: 'Invalid request' });
  }
  try {
    const t = await pool.query('SELECT 1 FROM tasks WHERE id = $1 AND group_id = $2', [taskId, req.groupId]);
    if (t.rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    if (done) {
      await pool.query(
        'INSERT INTO task_completions (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [taskId, req.user.id]
      );
    } else {
      await pool.query('DELETE FROM task_completions WHERE task_id = $1 AND user_id = $2', [taskId, req.user.id]);
    }
    res.json({ done });
  } catch (e) {
    console.error('mark task done failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/groups/:id/tasks/:taskId  (tutor only) - also removes the task file and hand-ins from storage
router.delete('/:id/tasks/:taskId', auth, ready, loadAccess, tutorOnly, async (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Invalid task' });
  try {
    const found = await pool.query(
      'SELECT attachment_url FROM tasks WHERE id = $1 AND group_id = $2',
      [taskId, req.groupId]
    );
    if (found.rows.length === 0) return res.status(404).json({ message: 'Task not found' });
    const subs = await pool.query('SELECT file_url FROM task_submissions WHERE task_id = $1', [taskId]);

    await pool.query('DELETE FROM tasks WHERE id = $1 AND group_id = $2', [taskId, req.groupId]);

    await removeFromStorage(storagePathFromUrl(found.rows[0].attachment_url));
    for (const s of subs.rows) await removeFromStorage(storagePathFromUrl(s.file_url));
    res.json({ message: 'Task removed' });
  } catch (e) {
    console.error('delete task failed:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
