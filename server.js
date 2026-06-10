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
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL UNIQUE,
    varsta   TEXT NOT NULL,
    inaltime TEXT NOT NULL,
    greutate TEXT NOT NULL,
    scop     TEXT NOT NULL,
    zile     INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS workout_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    exercise  TEXT NOT NULL,
    sets      INTEGER NOT NULL,
    reps      INTEGER NOT NULL,
    kg        REAL NOT NULL,
    logged_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  saveDB();
  console.log('✅ Baza de date initializata.');
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

app.use(express.json());
app.use(express.static(__dirname));

/* ══════════════════════════════════════
   ALGORITM SPLIT
   Generează recomandări bazate pe:
   - vârstă, înălțime, greutate, scop, zile
══════════════════════════════════════ */
function genereazaSplit(varsta, inaltime, greutate, scop, zile) {
  // BMI pentru a detecta dacă e începător sau avansat
  const bmi = greutate / ((inaltime / 100) ** 2);

  // Nivel estimat: sub 20 ani sau BMI foarte mare → probabil începător
  const esteIncepator = varsta < 18 || bmi > 32;

  // Recomandări de serii/rep bazate pe scop
  const paramScop = {
    'Masă musculară': { serii: '3-4', rep: '6-10',   nota: 'Greutate mare, pauze 2-3 min între serii.' },
    'Forță':          { serii: '2-3', rep: '3-5',    nota: 'Greutate maximală, pauze 3-5 min între serii.' },
    'Recompoziție':   { serii: '3-4', rep: '10-12',  nota: 'Greutate moderată, pauze 60-90 sec.' },
    'Slăbit':         { serii: '3-4', rep: '15-20',  nota: 'Greutate ușoară, pauze scurte 30-60 sec.' },
  };

  const params = paramScop[scop] || paramScop['Masă musculară'];

  // Splituri disponibile per număr de zile
  const splituri = {
    2: [
      { name: 'Full Body x2', descriere: 'Antrenezi tot corpul de 2 ori pe săptămână. Ideal pentru începători.' }
    ],
    3: esteIncepator
      ? [{ name: 'Full Body x3', descriere: 'Tot corpul de 3 ori pe săptămână. Potrivit pentru nivel începător.' }]
      : [
          { name: 'Upper/Lower + Full Body', descriere: 'Upper luni, Lower miercuri, Full Body vineri.' },
          { name: 'Full Body x3', descriere: 'Tot corpul de 3 ori, bun și pentru intermediari.' }
        ],
    4: esteIncepator
      ? [{ name: 'Upper/Lower x2', descriere: 'Upper de 2 ori, Lower de 2 ori pe săptămână.' }]
      : [
          { name: 'Upper/Lower x2', descriere: 'Upper de 2 ori, Lower de 2 ori pe săptămână.' },
          { name: 'PPL + Full Body', descriere: 'Push, Pull, Legs + o zi Full Body.' }
        ],
    5: esteIncepator
      ? [{ name: 'PPL', descriere: 'Push/Pull/Legs pe 5 zile cu o zi de repetare.' }]
      : [
          { name: 'PPL', descriere: 'Push luni, Pull marți, Legs miercuri, Push joi, Pull vineri.' },
          { name: 'Arnold Split + Legs', descriere: 'Chest+Back, Shoulders+Arms, Legs, repetat.' }
        ],
    6: [
      { name: 'PPL x2', descriere: 'Push/Pull/Legs repetat de două ori pe săptămână.' },
      { name: 'Arnold Split + Legs', descriere: 'Chest+Back, Shoulders+Arms, Legs x2.' }
    ],
  };

  const splits = splituri[zile] || splituri[3];

  return {
    splits,
    params,
    esteIncepator,
    bmi: bmi.toFixed(1)
  };
}

/* ── REGISTER ── */
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Completează toate câmpurile!' });
  if (name.trim().length > 20)
    return res.status(400).json({ error: 'Numele nu poate depăși 20 de caractere!' });
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email))
    return res.status(400).json({ error: 'Email invalid!' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere!' });

  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length > 0 && existing[0].values.length > 0)
    return res.status(409).json({ error: 'Cont deja existent!' });

  try {
    const hash = await bcrypt.hash(password, 12);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase(), hash]);
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
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email))
    return res.status(400).json({ error: 'Email invalid!' });

  const result = db.exec('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (result.length === 0 || result[0].values.length === 0)
    return res.status(401).json({ error: 'Email sau parolă incorectă!' });

  const cols = result[0].columns;
  const user = Object.fromEntries(cols.map((c, i) => [c, result[0].values[0][i]]));

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.status(401).json({ error: 'Email sau parolă incorectă!' });

  return res.json({ message: 'Autentificare reușită!', id: user.id, name: user.name, email: user.email });
});

/* ── SAVE PROFILE ── */
app.post('/api/profile', (req, res) => {
  const { user_id, varsta, inaltime, greutate, scop, zile } = req.body;
  if (!user_id || !varsta || !inaltime || !greutate || !scop || !zile)
    return res.status(400).json({ error: 'Date incomplete!' });
  try {
    db.run(`INSERT OR REPLACE INTO user_profiles (user_id, varsta, inaltime, greutate, scop, zile)
            VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, String(varsta), String(inaltime), String(greutate), scop, parseInt(zile)]);
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
  if (!user_id) return res.status(400).json({ error: 'user_id necesar!' });
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

/* ── ALGORITM SPLIT ── */
app.post('/api/split', (req, res) => {
  const { varsta, inaltime, greutate, scop, zile } = req.body;
  if (!varsta || !inaltime || !greutate || !scop || !zile)
    return res.status(400).json({ error: 'Date incomplete!' });

  const rezultat = genereazaSplit(
    parseInt(varsta), parseInt(inaltime),
    parseInt(greutate), scop, parseInt(zile)
  );
  return res.json(rezultat);
});

/* ── SAVE WORKOUT LOG ── */
app.post('/api/log', (req, res) => {
  const { user_id, exercise, sets, reps, kg } = req.body;
  if (!user_id || !exercise || sets == null || reps == null || kg == null)
    return res.status(400).json({ error: 'Date incomplete!' });
  if (sets <= 0 || reps <= 0 || kg < 0)
    return res.status(400).json({ error: 'Valorile trebuie să fie pozitive!' });
  try {
    db.run('INSERT INTO workout_logs (user_id, exercise, sets, reps, kg) VALUES (?, ?, ?, ?, ?)',
      [user_id, exercise, sets, reps, kg]);
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
    const logs = result[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
    return res.json({ logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la citire.' });
  }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ GymTips rulează pe http://localhost:${PORT}`));
});