const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Neon PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 1. SIGNUP API (Customer Portal)
app.post('/api/signup', async (req, res) => {
  const { username, full_name, email, password, role } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (username, full_name, email, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, full_name, role, profile_pic',
      [username, full_name, email, password, role || 'customer']
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. LOGIN API (Customer & Admin)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Username ykn Password dogoggora!" });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST SUBMISSION (Customer pending queue)
app.post('/api/posts', async (req, res) => {
  const { user_id, content, media_url } = req.body;
  try {
    await pool.query(
      'INSERT INTO posts (user_id, content, media_url, status) VALUES ($1, $2, $3, $4)',
      [user_id, content, media_url, 'pending']
    );
    res.json({ success: true, message: "Postiin keessan ergameera! Admin erga mirkaneessee booda ni darba." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. GET APPROVED PUBLIC POSTS
app.get('/api/posts/approved', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT posts.*, users.full_name, users.profile_pic 
      FROM posts JOIN users ON posts.user_id = users.id 
      WHERE posts.status = 'approved' ORDER BY posts.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. ADMIN: GET PENDING POSTS
app.get('/api/admin/pending', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT posts.*, users.full_name 
      FROM posts JOIN users ON posts.user_id = users.id 
      WHERE posts.status = 'pending'
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. ADMIN: APPROVE POST
app.post('/api/admin/approve', async (req, res) => {
  const { post_id } = req.body;
  try {
    await pool.query("UPDATE posts SET status = 'approved' WHERE id = $1", [post_id]);
    res.json({ success: true, message: "Postiin mirkanaa'eera!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. ADMIN: REJECT POST
app.post('/api/admin/reject', async (req, res) => {
  const { post_id } = req.body;
  try {
    await pool.query("DELETE FROM posts WHERE id = $1", [post_id]);
    res.json({ success: true, message: "Postiin haqameera!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
