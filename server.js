const express   = require('express');
const bcrypt    = require('bcrypt');
const path      = require('path');
const fs        = require('fs');
const initSqlJs = require('sql.js');

const app     = express();
const DB_PATH = path.join(__dirname, 'database.db');

let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL UNIQUE,
      varsta   TEXT NOT NULL,
      inaltime TEXT NOT NULL,
      greutate TEXT NOT NULL,
      scop     TEXT NOT NULL,
      zile     INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS workout_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      exercise    TEXT NOT NULL,
      sets        INTEGER NOT NULL,
      reps        INTEGER NOT NULL,
      kg          REAL NOT NULL,
      logged_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  saveDB();
  console.log('✅ Baza de date inițializată.');
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── REGISTER ── */
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Completează toate câmpurile!' });
  if (name.trim().length > 20)
    return res.status(400).json({ error: 'Numele nu poate depăși 20 de caractere!' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return res.status(400).json({ error: 'Email invalid!' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere!' });

  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length > 0 && existing[0].values.length > 0)
    return res.status(409).json({ error: 'Cont deja existent!' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase(), passwordHash]);
    saveDB();
    return res.status(201).json({ message: 'Cont creat cu succes!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la crearea contului.' });
  }
});

/* ── LOGIN ── */
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Completează toate câmpurile!' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return res.status(400).json({ error: 'Email invalid!' });

  const result = db.exec('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (result.length === 0 || result[0].values.length === 0)
    return res.status(401).json({ error: 'Email sau parolă incorectă!' });

  const cols = result[0].columns;
  const row  = result[0].values[0];
  const user = Object.fromEntries(cols.map((c, i) => [c, row[i]]));

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.status(401).json({ error: 'Email sau parolă incorectă!' });

  return res.json({ message: 'Autentificare reușită!', id: user.id, name: user.name });
});

/* ── SAVE PROFILE ── */
app.post('/api/profile', (req, res) => {
  const { user_id, varsta, inaltime, greutate, scop, zile } = req.body;
  if (!user_id || !varsta || !inaltime || !greutate || !scop || !zile)
    return res.status(400).json({ error: 'Date incomplete!' });

  try {
    // INSERT OR REPLACE — dacă există deja profilul, îl suprascrie
    db.run(
      `INSERT OR REPLACE INTO user_profiles (user_id, varsta, inaltime, greutate, scop, zile)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, varsta, inaltime, greutate, scop, zile]
    );
    saveDB();
    return res.status(201).json({ message: 'Profil salvat!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la salvare.' });
  }
});

/* ── GET PROFILE ── */
app.get('/api/profile', (req, res) => {
  const { user_id } = req.query;
  if (!user_id)
    return res.status(400).json({ error: 'user_id necesar!' });

  try {
    const result = db.exec(
      'SELECT varsta, inaltime, greutate, scop, zile FROM user_profiles WHERE user_id = ?',
      [user_id]
    );
    if (result.length === 0 || result[0].values.length === 0)
      return res.json({ profile: null });

    const cols    = result[0].columns;
    const profile = Object.fromEntries(cols.map((c, i) => [c, result[0].values[0][i]]));
    return res.json({ profile });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la citire.' });
  }
});

/* ── SAVE WORKOUT LOG ── */
app.post('/api/log', (req, res) => {
  const { user_id, exercise, sets, reps, kg } = req.body;
  if (!user_id || !exercise || sets == null || reps == null || kg == null)
    return res.status(400).json({ error: 'Date incomplete!' });
  if (sets <= 0 || reps <= 0 || kg < 0)
    return res.status(400).json({ error: 'Valorile trebuie să fie pozitive!' });

  try {
    db.run(
      'INSERT INTO workout_logs (user_id, exercise, sets, reps, kg) VALUES (?, ?, ?, ?, ?)',
      [user_id, exercise, sets, reps, kg]
    );
    saveDB();
    return res.status(201).json({ message: 'Antrenament salvat!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la salvare.' });
  }
});

/* ── GET WORKOUT LOG ── */
app.get('/api/log', (req, res) => {
  const { user_id, exercise } = req.query;
  if (!user_id || !exercise)
    return res.status(400).json({ error: 'user_id și exercise sunt necesare!' });

  try {
    const result = db.exec(
      'SELECT sets, reps, kg, logged_at FROM workout_logs WHERE user_id = ? AND exercise = ? ORDER BY logged_at DESC LIMIT 10',
      [user_id, exercise]
    );
    if (result.length === 0) return res.json({ logs: [] });

    const cols = result[0].columns;
    const logs = result[0].values.map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    );
    return res.json({ logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la citire.' });
  }
});

const PORT = 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ GymTips rulează pe http://localhost:${PORT}`);
  });
});