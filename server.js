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

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // 1. Tabel pentru UTILIZATORI
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 2. Tabel pentru PROFILURI (Datele din Chestionar)
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id    INTEGER PRIMARY KEY,
      varsta     INTEGER NOT NULL,
      inaltime   INTEGER NOT NULL,
      greutate   INTEGER NOT NULL,
      scop       TEXT NOT NULL,
      zile       INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  saveDB();
  console.log('✅ Baza de date și tabelele au fost inițializate.');
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
   AUTENTIFICARE: Înregistrare & Login
══════════════════════════════════════ */
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Completează toate câmpurile!' });
  if (name.trim().length > 20) return res.status(400).json({ error: 'Numele nu poate depăși 20 de caractere!' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Email invalid!' });
  if (password.length < 6) return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere!' });

  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    return res.status(409).json({ error: 'Cont deja existent!' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name.trim(), email.toLowerCase(), passwordHash]);
    saveDB();
    return res.status(201).json({ message: 'Cont creat cu succes!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la crearea contului.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Completează toate câmpurile!' });

  const result = db.exec('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (result.length === 0 || result[0].values.length === 0) return res.status(401).json({ error: 'Email sau parolă incorectă!' });

  const cols = result[0].columns;
  const row  = result[0].values[0];
  const user = Object.fromEntries(cols.map((c, i) => [c, row[i]]));

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Email sau parolă incorectă!' });
  return res.json({ id: user.id, name: user.name, email: user.email });
});

/* ══════════════════════════════════════
   QUIZ: Calculează recomandarea de antrenament
   (Serii după ZILE + Repetări după SCOP)
══════════════════════════════════════ */
app.post('/api/split', (req, res) => {
  const { varsta, inaltime, greutate, scop, zile } = req.body;

  // Calculul indicelui de masă corporală (BMI)
  const inaltimeM = inaltime / 100;
  const bmi = (greutate / (inaltimeM * inaltimeM)).toFixed(1);

  // Estimare nivel pe baza numărului de zile selectate
  const esteIncepator = zile <= 3;

  // 1. LOGICĂ SERII (bazată strict pe numărul de ZILE solicitat de tine)
  let serii = '2'; 
  if (zile === 1 || zile === 2) {
    serii = '1';
  } else if (zile === 3 || zile === 4) {
    serii = '2';
  } else if (zile === 5) {
    serii = '2-3';
  } else if (zile === 6) {
    serii = '3-4';
  }

  // 2. LOGICĂ REPETĂRI & NOTĂ (bazată strict pe SCOPUL introdus)
  let rep = '10-12'; // valoare de siguranță (default)
  let nota = 'Program optimizat pentru obiectivele tale.';
  const scopLower = scop.toLowerCase();

  if (scopLower.includes('masă') || scopLower.includes('masa') || scopLower.includes('musculară') || scopLower.includes('musculara')) {
    rep = '8-10';
    nota = 'Volum perfect pentru hipertrofie (creștere în masă musculară).';
  } else if (scopLower.includes('slăbit') || scopLower.includes('slabit') || scopLower.includes('slabire')) {
    rep = '10-12';
    nota = 'Repetări mai multe pentru un consum caloric ridicat și definire.';
  } else if (scopLower.includes('refacere') || scopLower.includes('recuperare')) {
    rep = '10-12';
    nota = 'Focus pe execuție impecabilă și pomparea sângelui pentru refacere musculară.';
  } else if (scopLower.includes('forță') || scopLower.includes('forta')) {
    rep = '6';
    nota = 'Intensitate crescută. Ideal pentru dezvoltarea sistemului nervos central și a forței brute.';
  }

  // Împachetăm rezultatele obținute din cele două reguli
  const params = { serii, rep, nota };

  // Generarea opțiunilor de split-uri de antrenament potrivite zilelor selectate
  const optiuniSplits = {
    1: [{ name: 'Full Body Expres', descriere: 'O singură sesiune intensă pentru a stimula tot corpul.' }],
    2: [{ name: 'Full Body 2x', descriere: 'Ideal pentru frecvență ridicată și timp limitat de antrenament.' }],
    3: [
      { name: 'PPL/UL', descriere: 'Împărțire clasică Push/Pull/Legs comprimată eficient.' },
      { name: 'Full Body 3x', descriere: 'Stimularea întregului corp de trei ori pe săptămână, perfect pentru progres.' }
    ],
    4: [
      { name: 'Upper/Lower', descriere: 'Diviziune ideală pentru o recuperare superioară a grupelor mari.' },
      { name: 'PPL+Full', descriere: 'Trei zile dedicate segmentelor și o zi dedicată întregului corp.' }
    ],
    5: [
      { name: 'PPL', descriere: 'Push, Pull, Legs continuu, excelent pentru pasionații avansați.' },
      { name: 'Bro Split', descriere: 'Diviziunea clasică de culturism: o singură grupă musculară pe antrenament.' }
    ],
    6: [
      { name: 'PPL x2', descriere: 'Volum maxim de muncă pentru sportivii experimentați.' },
      { name: 'Arnold Split', descriere: 'Gruparea clasică: Piept+Spate, Umeri+Brațe, Picioare.' }
    ]
  };

  const splits = optiuniSplits[zile] || [{ name: 'Personalizat', descriere: 'Consultă un antrenor pentru acest număr de zile.' }];

  return res.json({ bmi, esteIncepator, params, splits });
});
/* ══════════════════════════════════════
   PROFIL: Salvare și Încărcare date profil
══════════════════════════════════════ */
// Salvează sau actualizează profilul
app.post('/api/profile', (req, res) => {
  const { user_id, varsta, inaltime, greutate, scop, zile } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Utilizatorul nu este autentificat.' });

  try {
    db.run(`
      INSERT INTO profiles (user_id, varsta, inaltime, greutate, scop, zile)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        varsta=excluded.varsta,
        inaltime=excluded.inaltime,
        greutate=excluded.greutate,
        scop=excluded.scop,
        zile=excluded.zile
    `, [user_id, varsta, inaltime, greutate, scop, zile]);
    
    saveDB();
    return res.json({ message: 'Profil actualizat cu succes!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la salvarea profilului.' });
  }
});

// Preia datele profilului pentru auto-completare
app.get('/api/profile', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'Lipsește ID-ul utilizatorului.' });

  try {
    const result = db.exec('SELECT * FROM profiles WHERE user_id = ?', [user_id]);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.json({ profile: null });
    }

    const cols = result[0].columns;
    const row  = result[0].values[0];
    const profile = Object.fromEntries(cols.map((c, i) => [c, row[i]]));

    return res.json({ profile });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Eroare la încărcarea profilului.' });
  }
});

/* ── Pornire server ── */
const PORT = 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ GymTips rulează pe http://localhost:${PORT}`));
});