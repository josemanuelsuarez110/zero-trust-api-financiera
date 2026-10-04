const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { setTimeout: pause } = require('node:timers/promises');

const BASE = 'http://127.0.0.1:3001';
const LOG = 'logs/security-session.log';
let passed = 0;

async function check(path, options, expected) {
  const response = await fetch(BASE + path, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  assert.equal(response.status, expected.status);

  const id = response.headers.get('x-request-id');
  assert.ok(id, 'Falta X-Request-ID');

  let matches = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const text = await fs.readFile(LOG, 'utf8');
    matches = text.split('\n').flatMap(line => {
      try {
        const event = JSON.parse(line);
        return event && event.request_id === id ? [event] : [];
      } catch {
        return [];
      }
    });
    if (matches.length) break;
    await pause(100);
  }

  assert.equal(matches.length, 1, 'Debe existir exactamente un evento por solicitud');
  const event = matches[0];

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(event[key], value, `Campo incorrecto: ${key}`);
  }
  assert.ok(Number.isFinite(Date.parse(event.timestamp)), 'Fecha inválida');

  const allowed = [
    'timestamp', 'request_id', 'event', 'method',
    'route', 'status', 'subject', 'organization_id', 'role',
  ].sort();
  assert.deepEqual(Object.keys(event).sort(), allowed, 'Campos de registro inesperados');

  passed++;
  console.log(`OK ${passed}: ${event.event}, HTTP ${event.status}, correlación correcta`);
  return body;
}

async function main() {
  const anonymous = { subject: null, organization_id: null, role: null };
  const denied = {
    ...anonymous,
    event: 'authentication_rejected',
    method: 'GET',
    route: '/api/transacciones',
  };

  await check('/api/transacciones', {}, { ...denied, status: 401 });
  await check('/api/transacciones', {
    headers: { Authorization: 'Bearer invalid-audit-test-token' },
  }, { ...denied, status: 403 });

  const login = password => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gerente10', password }),
  });

  await check('/api/auth/login', login('incorrecta'), {
    ...anonymous, event: 'login_rejected', status: 401,
    method: 'POST', route: '/api/auth/login',
  });

  const identity = {
    subject: 'gerente10', organization_id: 1, role: 'gerente_sucursal',
  };
  const auth = await check('/api/auth/login', login('demo-lab-only'), {
    ...identity, event: 'login_success', status: 200,
    method: 'POST', route: '/api/auth/login',
  });
  assert.equal(typeof auth.token, 'string');
  assert.ok(auth.token.length > 0);
  const options = { headers: { Authorization: `Bearer ${auth.token}` } };

  await check('/api/transacciones/201', options, {
    ...identity, event: 'resource_unavailable', status: 404,
    method: 'GET', route: '/api/transacciones/:id',
  });

  await check('/api/transacciones', options, {
    ...identity, event: 'transaction_read', status: 200,
    method: 'GET', route: '/api/transacciones',
  });

  console.log(`\nRESULTADO: ${passed} comprobaciones de auditoría aprobadas.`);
}

main().catch(error => {
  console.error('FALLO:', error.message);
  process.exitCode = 1;
});
