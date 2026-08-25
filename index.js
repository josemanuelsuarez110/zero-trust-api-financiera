require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || null;
const DATABASE_URL = process.env.DATABASE_URL || null;

// Do not crash the serverless function at module load time.
// Configuration errors are returned by the endpoint that needs them.
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 1,
    })
  : null;

app.get('/api/health', (_req, res) => {
  return res.json({
    ok: true,
    jwtConfigured: Boolean(JWT_SECRET),
    databaseConfigured: Boolean(DATABASE_URL),
  });
});

// ==========================================
// 1. ENDPOINT DE AUTENTICACIÓN FICTICIA (Mock)
// ==========================================
app.post('/api/auth/login', (req, res) => {
  if (!JWT_SECRET) {
    return res.status(500).json({
      error: 'Configuración incompleta',
      missing: 'JWT_SECRET',
    });
  }

  const { username, password } = req.body;

  let role = 'cliente';
  let sucursalId = null;

  if (username === 'gerente10' && password === '1234') {
    role = 'gerente_sucursal';
    sucursalId = 10;
  } else if (username === 'auditor' && password === 'admin') {
    role = 'auditor_regional';
  } else if (username === 'cajero5' && password === '123') {
    role = 'cajero';
    sucursalId = 5;
  } else if (username === 'cliente' && password === 'pass') {
    role = 'cliente';
  } else {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign(
    { username, role, sucursalId },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  return res.json({
    message: 'Login exitoso',
    token,
    role,
    sucursalId,
  });
});

// ==========================================
// 2. MIDDLEWARE ZERO-TRUST (JWT + RLS)
// ==========================================
const authenticateAndSetRLS = async (req, res, next) => {
  if (!JWT_SECRET) {
    return res.status(500).json({
      error: 'Configuración incompleta',
      missing: 'JWT_SECRET',
    });
  }

  if (!DATABASE_URL || !pool) {
    return res.status(500).json({
      error: 'Configuración incompleta',
      missing: 'DATABASE_URL',
    });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authorization Bearer requerido',
    });
  }

  const token = authHeader.slice(7).trim();

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('JWT VERIFY ERROR:', error.message);
    return res.status(403).json({
      error: 'Token inválido o expirado',
    });
  }

  let client;

  try {
    client = await pool.connect();
    req.dbClient = client;

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE dummy_test');

    await client.query(
      "SELECT set_config('app.current_rol', $1, true)",
      [req.user.role || '']
    );

    await client.query(
      "SELECT set_config('app.current_sucursal', $1, true)",
      [req.user.sucursalId == null ? '' : String(req.user.sucursalId)]
    );

    return next();
  } catch (error) {
    console.error('DATABASE/RLS ERROR:', error);

    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      client.release();
    }

    return res.status(500).json({
      error: 'Error configurando contexto Zero-Trust',
      code: error.code || null,
      detail: process.env.NODE_ENV === 'production' ? undefined : error.message,
    });
  }
};

// ==========================================
// 3. ENDPOINTS PROTEGIDOS POR BASE DE DATOS
// ==========================================
app.get('/api/transacciones', authenticateAndSetRLS, async (req, res) => {
  try {
    const result = await req.dbClient.query(
      'SELECT id, monto, sucursal_id, fecha FROM Transacciones ORDER BY fecha DESC LIMIT 50;'
    );

    await req.dbClient.query('COMMIT');

    return res.json({
      total_accedidas: result.rowCount,
      transacciones: result.rows,
    });
  } catch (error) {
    console.error('TRANSACTION QUERY ERROR:', error);

    try {
      await req.dbClient.query('ROLLBACK');
    } catch (_) {}

    return res.status(500).json({
      error: 'Error consultando transacciones',
      code: error.code || null,
    });
  } finally {
    if (req.dbClient) req.dbClient.release();
  }
});

app.get('/api/clientes-ofuscados', authenticateAndSetRLS, async (req, res) => {
  try {
    const result = await req.dbClient.query(
      'SELECT cliente_uuid, identidad_ofuscada, sucursal_id FROM vista_publica_clientes LIMIT 50;'
    );

    await req.dbClient.query('COMMIT');
    return res.json(result.rows);
  } catch (error) {
    console.error('CLIENT QUERY ERROR:', error);

    try {
      await req.dbClient.query('ROLLBACK');
    } catch (_) {}

    return res.status(500).json({
      error: 'Error consultando clientes',
      code: error.code || null,
    });
  } finally {
    if (req.dbClient) req.dbClient.release();
  }
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Zero-Trust Financial API corriendo localmente en el puerto ${PORT}`);
  });
}
