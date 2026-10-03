const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const config = require('dotenv').config({
  path: path.join(__dirname, '..', '.env.lab'),
  override: true,
});
if (config.error) throw config.error;

const db = new URL(process.env.DATABASE_URL);
if (
  process.env.LAB_MODE !== 'true' ||
  db.hostname !== '127.0.0.1' ||
  db.port !== '5432' ||
  db.pathname !== '/zt_security_lab' ||
  db.username !== 'zt_lab_app' ||
  db.search ||
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET.length < 32
) {
  throw new Error('Configuración de laboratorio inválida');
}

const pool = new Pool({
  connectionString: db.toString(),
  ssl: false,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});

const identities = new Map([
  ['gerente10', { org: 1, branch: 10, role: 'gerente_sucursal' }],
  ['auditor', { org: 1, branch: null, role: 'auditor_regional' }],
  ['gerenteB', { org: 2, branch: 10, role: 'gerente_sucursal' }],
  ['auditorB', { org: 2, branch: null, role: 'auditor_regional' }],
]);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Identidades ficticias: contraseña exclusiva de esta demo local.
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!identities.has(username) || password !== 'demo-lab-only') {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    subject: username,
    issuer: 'zt-lab',
    audience: 'zt-lab-api',
    algorithm: 'HS256',
    expiresIn: '15m',
  });
  return res.json({ token, role: identities.get(username).role });
});

app.use('/api/transacciones', (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer requerido' });
  }
  try {
    const claims = jwt.verify(header.slice(7), process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'zt-lab',
      audience: 'zt-lab-api',
    });
    const identity = identities.get(claims.sub);
    if (!identity) throw new Error('Identidad desconocida');
    req.identity = identity;
    next();
  } catch {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
});

async function readTransactions(req, res) {
  const id = req.params.id;
  if (id && (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `SELECT
        set_config('app.current_organizacion', $1, true),
        set_config('app.current_rol', $2, true),
        set_config('app.current_sucursal', $3, true)`,
      [
        String(req.identity.org),
        req.identity.role,
        req.identity.branch === null ? '' : String(req.identity.branch),
      ]
    );
    const result = await client.query(
      `SELECT id, organizacion_id, sucursal_id, monto, fecha
       FROM public.transacciones
       ${id ? 'WHERE id = $1' : ''}
       ORDER BY id LIMIT 50`,
      id ? [Number(id)] : []
    );
    await client.query('COMMIT');

    if (id) {
      return result.rows.length
        ? res.json(result.rows[0])
        : res.status(404).json({ error: 'Transacción no encontrada' });
    }
    return res.json({
      total_accedidas: result.rowCount,
      transacciones: result.rows,
    });
  } catch {
    if (client) {
      try { await client.query('ROLLBACK'); }
      catch { discard = true; }
    }
    return res.status(500).json({ error: 'Error en consulta de laboratorio' });
  } finally {
    if (client) client.release(discard);
  }
}

app.get('/api/transacciones', readTransactions);
app.get('/api/transacciones/:id', readTransactions);

async function start() {
  const result = await pool.query(
    `SELECT current_database() AS db, current_user AS usr,
            rolsuper, rolbypassrls
     FROM pg_roles WHERE rolname = current_user`
  );
  const role = result.rows[0];
  if (
    !role ||
    role.db !== 'zt_security_lab' ||
    role.usr !== 'zt_lab_app' ||
    role.rolsuper ||
    role.rolbypassrls
  ) throw new Error('La conexión no cumple los permisos requeridos');

  const server = app.listen(3001, '127.0.0.1', () => {
    console.log('Laboratorio listo: http://127.0.0.1:3001');
  });
  server.on('error', async () => {
    console.error('No se pudo abrir el puerto 3001');
    await pool.end();
    process.exitCode = 1;
  });
}

start().catch(async () => {
  console.error('No se pudo iniciar: revisa PostgreSQL y .env.lab');
  await pool.end();
  process.exitCode = 1;
});
