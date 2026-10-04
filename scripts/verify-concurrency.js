const assert = require('node:assert/strict');

const BASE = 'http://127.0.0.1:3001';
const identities = [
  { username: 'gerente10', org: 1, ids: [101] },
  { username: 'auditor', org: 1, ids: [101, 102] },
  { username: 'gerenteB', org: 2, ids: [201] },
  { username: 'auditorB', org: 2, ids: [201, 202] },
];

async function login(identity) {
  const response = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: identity.username,
      password: 'demo-lab-only',
    }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  assert.equal(response.status, 200, 'Login: ' + identity.username);
  const data = await response.json();
  assert.equal(typeof data.token, 'string');
  assert.ok(data.token.length > 0);
  return { ...identity, token: data.token };
}

async function verify(identity) {
  const response = await fetch(BASE + '/api/transacciones', {
    headers: { Authorization: 'Bearer ' + identity.token },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  assert.equal(response.status, 200, identity.username);

  const data = await response.json();
  assert.ok(Array.isArray(data.transacciones));
  assert.deepEqual(
    data.transacciones.map(row => row.id),
    identity.ids,
    'Registros incorrectos: ' + identity.username
  );
  assert.equal(data.total_accedidas, identity.ids.length);
  assert.ok(
    data.transacciones.every(row => row.organizacion_id === identity.org),
    'Cruce de organización: ' + identity.username
  );

  const requestId = response.headers.get('x-request-id');
  assert.ok(requestId, 'Falta identificador de solicitud');
  return requestId;
}

async function main() {
  const users = await Promise.all(identities.map(login));
  const seen = new Set();

  for (let round = 0; round < 5; round++) {
    const batch = Array.from(
      { length: 8 },
      (_, index) => users[(index + round) % users.length]
    );
    const results = await Promise.allSettled(batch.map(verify));
    const failures = results.filter(result => result.status === 'rejected');

    if (failures.length) {
      for (const failure of failures) {
        console.error('FALLO:', failure.reason.message);
      }
      throw new Error('Ronda concurrente fallida');
    }

    for (const result of results) {
      assert.ok(!seen.has(result.value), 'Request ID duplicado');
      seen.add(result.value);
    }
    console.log(`OK: ronda ${round + 1}, 8 solicitudes verificadas`);
  }

  assert.equal(seen.size, 40);
  console.log('\nRESULTADO: 40 solicitudes concurrentes verificadas.');
  console.log('Sin mezcla de datos en los casos probados; pool de una conexión.');
}

main().catch(error => {
  console.error('PRUEBA FALLIDA:', error.message);
  process.exitCode = 1;
});
