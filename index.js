require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Secret temporal para JWT (En producción se inyecta desde Vercel Environment Variables)
const JWT_SECRET = process.env.JWT_SECRET || 'zero-trust-super-secret-key-2026';

// Servir el frontend estático visual
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// Configuración recomendada para Vercel y Serverless Neon Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_5IEt2xbjKkUr@ep-proud-field-a49vdzd4-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: true }, 
  max: 1 // Pool = 1 es recomendado para Serverless (Vercel lambda/Edge)
});

// ==========================================
// 1. ENDPOINT DE AUTENTICACIÓN FICTICIA (Mock)
// ==========================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  // En la vida real, se valida contra la DB. Por rapidez:
  let role = 'cliente';
  let sucursalId = null;

  if (username === 'gerente10' && password === '1234') {
    role = 'gerente_sucursal';
    sucursalId = 10;
  } else if (username === 'auditor' && password === 'admin') {
    role = 'auditor_regional';
    sucursalId = null;
  } else if (username === 'cajero5' && password === '123') {
    role = 'cajero';
    sucursalId = 5;
  } else if (username === 'cliente' && password === 'pass') {
    role = 'cliente';
  } else {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  // Firmar token con payload Zero-Trust
  const token = jwt.sign({ username, role, sucursalId }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ message: 'Login exitoso', token, role, sucursalId });
});

// ==========================================
// 2. MIDDLEWARE ZERO-TRUST (Validación e Inyección)
// ==========================================
// Verifica JWT y establece el RLS Environment en el cliente de base de datos
const authenticateAndSetRLS = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No se envió Authorization Header' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { username, role, sucursalId }

    // 🔥 ADQUIERE CLIENTE DEL POOL EXCLUSIVO PARA ESTA TRANSACCIÓN / REQUEST
    const client = await pool.connect();
    req.dbClient = client;

    // 🔥 INYECCIÓN DE CONTEXTO RLS AL SERVIDOR POSTGRESQL (LA MAGIA ZERO-TRUST)
    // El rol dummy_test es un puente para que PostgreSQL aplique las RLS (Como configuramos en el paso anterior)
    await client.query("SET ROLE dummy_test;");
    
    // Inyectar contexto a PostgreSQL
    await client.query("SET LOCAL app.current_rol = $1;", [req.user.role]);
    await client.query("SET LOCAL app.current_sucursal = $1;", [req.user.sucursalId || '']); // Maneja null para Auditores

    // Continúa con el endpoint
    next();
  } catch (error) {
    res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

// ==========================================
// 3. ENDPOINTS PROTEGIDOS POR BASE DE DATOS
// ==========================================

// Obtener todas las transacciones (La DB decide, NO el código de Node, si el usuario las verá o no)
app.get('/api/transacciones', authenticateAndSetRLS, async (req, res) => {
  try {
    // Si es un gerente de sucursal 10, PostgreSQL SOLO DEVOLVERÁ las TX de la sucursal 10.
    // Si es un auditor, PostgreSQL DEVOLVERÁ TODAS las TX.
    // Esto previene inyecciones y fugas de datos masivas.
    const result = await req.dbClient.query(
      "SELECT id, monto, sucursal_id, fecha FROM Transacciones ORDER BY fecha DESC LIMIT 50;"
    );
    res.json({
        total_accedidas: result.rowCount,
        transacciones: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    // 🔥 CRÍTICO: Liberar (limpiar) el cliente al Pool para evitar envenenamiento de sesiones con RLS antiguas
    if (req.dbClient) req.dbClient.release();
  }
});

// Endpoint público/anonimizado: (Ver hashes en lugar de nombres)
app.get('/api/clientes-ofuscados', authenticateAndSetRLS, async (req, res) => {
  try {
    const result = await req.dbClient.query(
      "SELECT cliente_uuid, identidad_ofuscada, sucursal_id FROM vista_publica_clientes LIMIT 50;"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    // Liberar
    if (req.dbClient) req.dbClient.release();
  }
});

// Exportar Express app para Vercel o local
module.exports = app;

// Si no está corriendo en Vercel Serverless, levanta servidor local:
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Zero-Trust Financial API corriendo localmente en el puerto ${PORT}`);
  });
}
