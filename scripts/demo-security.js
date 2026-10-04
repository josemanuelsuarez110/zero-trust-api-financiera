const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');

const base = 'http://127.0.0.1:3001';
const logfile = path.join(__dirname, '..', 'logs', 'security-session.log');

async function request(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  return {
    status: response.status,
    id: response.headers.get('x-request-id'),
    body: await response.json(),
  };
}

async function evidence(response, expected) {
  assert.ok(response.id, 'Missing response request ID');
  for (let attempt = 0; attempt < 30; attempt++) {
    const text = await fs.readFile(logfile, 'utf8');
    const events = text.split('\n').flatMap(line => {
      try {
        const event = JSON.parse(line);
        return event && event.request_id === response.id ? [event] : [];
      } catch { return []; }
    });
    if (events.length) {
      assert.equal(events.length, 1, 'Duplicate audit event');
      const event = events[0];
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(event[key], value, 'Unexpected audit field: ' + key);
      }
      assert.equal(event.status, response.status, 'Audit status mismatch');
      assert.ok(Number.isFinite(Date.parse(event.timestamp)), 'Invalid timestamp');
      // Print selected fields only, never request bodies or credentials.
      return {
        timestamp: event.timestamp,
        request_id: event.request_id,
        event: event.event,
        status: event.status,
        subject: event.subject,
        organization_id: event.organization_id,
      };
    }
    await pause(100);
  }
  throw new Error('Matching audit event not found; start server with log capture');
}

async function main() {
  await fs.access(logfile);
  console.log('TENANT ISOLATION | Controlled local demonstration');
  console.log('Synthetic data. No production requests. No credentials displayed.\n');

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gerente10', password: 'demo-lab-only' }),
  });
  assert.equal(login.status, 200, 'Login failed');
  assert.equal(typeof login.body.token, 'string', 'Missing token');
  assert.ok(login.body.token.length > 0, 'Empty token');
  const headers = { Authorization: 'Bearer ' + login.body.token };
  const identity = { subject: 'gerente10', organization_id: 1, role: 'gerente_sucursal' };

  console.log('1. ALLOWED ACCESS');
  const own = await request('/api/transacciones/101', { headers });
  assert.equal(own.status, 200, 'Own transaction should be visible');
  assert.equal(own.body.id, 101);
  assert.equal(own.body.organizacion_id, 1);
  assert.equal(own.body.sucursal_id, 10);
  const allowedEvent = await evidence(own, {
    ...identity, event: 'transaction_read', method: 'GET',
    route: '/api/transacciones/:id',
  });
  console.log('Organization 1 / branch 10 -> transaction 101: HTTP 200');
  console.log(JSON.stringify({ id: own.body.id, organization: own.body.organizacion_id, branch: own.body.sucursal_id }));

  console.log('\n2. CROSS-ORGANIZATION ACCESS');
  const other = await request('/api/transacciones/201', { headers });
  assert.equal(other.status, 404, 'Foreign transaction should not be visible');
  assert.deepEqual(other.body, { error: 'Transacción no encontrada' });
  const deniedEvent = await evidence(other, {
    ...identity, event: 'resource_unavailable', method: 'GET',
    route: '/api/transacciones/:id',
  });
  console.log('Same user -> transaction 201 (organization 2 / branch 10): HTTP 404');
  console.log('No transaction data returned.');

  console.log('\n3. CORRELATED AUDIT EVIDENCE');
  console.log(JSON.stringify(allowedEvent, null, 2));
  console.log(JSON.stringify(deniedEvent, null, 2));
  console.log('Each event matches its HTTP response request ID.');
  console.log('The fixture identifies 201 as foreign; a 404 log alone does not prove an attack.');

  console.log('\nDEMO PASSED');
  console.log('Next: node scripts/verify-lab.js && node scripts/verify-audit.js');
  console.log('Scope: local demo identities; read isolation and audit correlation, not production certification.');
}

main().catch(() => {
  console.error('DEMO FAILED: check that the lab server is running with log capture and the original fixtures.');
  console.error('No successful demonstration is claimed. Run the verification suites for diagnostics.');
  process.exitCode = 1;
});
