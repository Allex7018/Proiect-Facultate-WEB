const express = require('express');
const bcrypt  = require('bcrypt');
const path    = require('path');
const fs      = require('fs');
const initSqlJs = require('sql.js');

const app     = express();
const DB_PATH = path.join(__dirname, 'database.db');

let db; // instanța bazei de date

/* ── Inițializare SQL.js ── */
async function initDB() {
  const SQL = await initSqlJs();

  // Dacă există deja fișierul, îl încărcăm; altfel creăm unul nou
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Creare tabel dacă nu există
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  saveDB();
  console.log('✅ Baza de date inițializată.');
}

/* ── Salvare pe disc ── */
function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/* ── Middleware ── */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════
   POST /api/register
══════════════════════════════════════ */
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

  // Verificare email unic
  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length > 0 && existing[0].values.length > 0)
    return res.status(409).json({ error: 'Cont deja existent!' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    db.run(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase(), passwordHash]
    );
    saveDB();
    return res.status(201).json({ message: 'Cont creat cu succes!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la crearea contului.' });
  }
});

/* ══════════════════════════════════════
   POST /api/login
══════════════════════════════════════ */
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

  return res.json({ message: 'Autentificare reușită!', name: user.name });
});

/* ── Pornire server ── */
const PORT = 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ GymTips rulează pe http://localhost:${PORT}`);
  });
});