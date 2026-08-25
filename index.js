require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();

app.disable('x-powered-by');

const JWT_SECRET = process.env.JWT_SECRET || null;
const DATABASE_URL = process.env.DATABASE_URL || null;

const allowedOrigins = [
  'https://zero-trust-api-financiera.vercel.app',
];

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // Requests same-origin or non-browser requests may have no Origin header.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error('Origin not allowed by CORS')
      );
    },
    methods: ['GET', 'POST'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
    ],
  })
);

app.use(
  express.json({
    limit: '32kb',
  })
);

app.use((req, res, next) => {
  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );

  res.setHeader(
    'X-Frame-Options',
    'DENY'
  );

  res.setHeader(
    'Referrer-Policy',
    'no-referrer'
  );

  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  next();
});

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: {
        rejectUnauthorized: true,
      },
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    })
  : null;

// ============================================
// HEALTH
// ============================================
app.get('/api/health', (_req, res) => {
  const jwtConfigured =
    Boolean(JWT_SECRET);

  const databaseConfigured =
    Boolean(DATABASE_URL);

  const ok =
    jwtConfigured &&
    databaseConfigured;

  return res
    .status(ok ? 200 : 503)
    .json({
      ok,
      jwtConfigured,
      databaseConfigured,
    });
});

// ============================================
// MOCK AUTHENTICATION
// Portfolio/demo authentication only.
// ============================================
app.post(
  '/api/auth/login',
  (req, res) => {
    if (!JWT_SECRET) {
      return res
        .status(503)
        .json({
          error:
            'Servicio no configurado',
        });
    }

    const {
      username,
      password,
    } = req.body || {};

    if (
      typeof username !== 'string' ||
      typeof password !== 'string'
    ) {
      return res
        .status(400)
        .json({
          error:
            'Usuario y contraseña requeridos',
        });
    }

    let role;
    let sucursalId = null;

    if (
      username === 'gerente10' &&
      password === '1234'
    ) {
      role = 'gerente_sucursal';
      sucursalId = 10;
    } else if (
      username === 'auditor' &&
      password === 'admin'
    ) {
      role = 'auditor_regional';
    } else if (
      username === 'cajero5' &&
      password === '123'
    ) {
      role = 'cajero';
      sucursalId = 5;
    } else if (
      username === 'cliente' &&
      password === 'pass'
    ) {
      role = 'cliente';
    } else {
      return res
        .status(401)
        .json({
          error:
            'Credenciales inválidas',
        });
    }

    const token = jwt.sign(
      {
        username,
        role,
        sucursalId,
      },
      JWT_SECRET,
      {
        expiresIn: '1h',
        algorithm: 'HS256',
      }
    );

    return res.json({
      message:
        'Login exitoso',
      token,
      role,
      sucursalId,
    });
  }
);

// ============================================
// ZERO-TRUST JWT + RLS
// ============================================
async function authenticateAndSetRLS(
  req,
  res,
  next
) {
  if (!JWT_SECRET || !pool) {
    return res
      .status(503)
      .json({
        error:
          'Servicio no configurado',
      });
  }

  const authHeader =
    req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith(
      'Bearer '
    )
  ) {
    return res
      .status(401)
      .json({
        error:
          'Authorization Bearer requerido',
      });
  }

  const token =
    authHeader
      .slice(7)
      .trim();

  try {
    req.user =
      jwt.verify(
        token,
        JWT_SECRET,
        {
          algorithms: [
            'HS256',
          ],
        }
      );
  } catch (error) {
    console.error(
      'JWT VERIFY ERROR:',
      error.message
    );

    return res
      .status(403)
      .json({
        error:
          'Token inválido o expirado',
      });
  }

  let client;

  try {
    client =
      await pool.connect();

    req.dbClient =
      client;

    await client.query(
      'BEGIN'
    );

    await client.query(
      'SET LOCAL ROLE dummy_test'
    );

    await client.query(
      "SELECT set_config('app.current_rol', $1, true)",
      [
        req.user.role ||
          '',
      ]
    );

    await client.query(
      "SELECT set_config('app.current_sucursal', $1, true)",
      [
        req.user
          .sucursalId == null
          ? ''
          : String(
              req.user
                .sucursalId
            ),
      ]
    );

    return next();
  } catch (error) {
    console.error(
      'DATABASE/RLS ERROR:',
      error
    );

    if (client) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch {}

      client.release();
    }

    return res
      .status(500)
      .json({
        error:
          'Error configurando contexto Zero-Trust',
      });
  }
}

// ============================================
// TRANSACTIONS
// ============================================
app.get(
  '/api/transacciones',
  authenticateAndSetRLS,
  async (req, res) => {
    try {
      const result =
        await req.dbClient
          .query(`
            SELECT
              id,
              monto,
              sucursal_id,
              fecha
            FROM Transacciones
            ORDER BY fecha DESC
            LIMIT 50
          `);

      await req.dbClient
        .query('COMMIT');

      return res.json({
        total_accedidas:
          result.rowCount,
        transacciones:
          result.rows,
      });
    } catch (error) {
      console.error(
        'TRANSACTION QUERY ERROR:',
        error
      );

      try {
        await req.dbClient
          .query('ROLLBACK');
      } catch {}

      return res
        .status(500)
        .json({
          error:
            'Error consultando transacciones',
        });
    } finally {
      if (req.dbClient) {
        req.dbClient.release();
      }
    }
  }
);

// ============================================
// OBFUSCATED CLIENT DATA
// ============================================
app.get(
  '/api/clientes-ofuscados',
  authenticateAndSetRLS,
  async (req, res) => {
    try {
      const result =
        await req.dbClient
          .query(`
            SELECT
              cliente_uuid,
              identidad_ofuscada,
              sucursal_id
            FROM vista_publica_clientes
            LIMIT 50
          `);

      await req.dbClient
        .query('COMMIT');

      return res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        'CLIENT QUERY ERROR:',
        error
      );

      try {
        await req.dbClient
          .query('ROLLBACK');
      } catch {}

      return res
        .status(500)
        .json({
          error:
            'Error consultando clientes',
        });
    } finally {
      if (req.dbClient) {
        req.dbClient.release();
      }
    }
  }
);

module.exports = app;

if (require.main === module) {
  const PORT =
    process.env.PORT ||
    3000;

  app.listen(
    PORT,
    () => {
      console.log(
        `Zero-Trust Financial API running on port ${PORT}`
      );
    }
  );
}
