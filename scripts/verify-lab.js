const assert = require('node:assert/strict');

const BASE = 'http://127.0.0.1:3001';
let passed = 0;

async function request(path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  return { status: response.status, data: await response.json() };
}

function ok(message) {
  passed++;
  console.log(`OK ${passed}: ${message}`);
}

async function login(username, extra = {}) {
  const result = await request('/api/auth/login', null, {
    username,
    password: 'demo-lab-only',
    ...extra,
  });
  assert.equal(result.status, 200, `Login de ${username}`);
  assert.equal(typeof result.data.token, 'string');
  assert.ok(result.data.token.length > 0);
  return result.data.token;
}

async function expectRows(token, ids, org, path = '/api/transacciones') {
  const result = await request(path, token);
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.data.transacciones));
  assert.deepEqual(result.data.transacciones.map(row => row.id), ids);
  assert.equal(result.data.total_accedidas, ids.length);
  assert.ok(result.data.transacciones.every(row => row.organizacion_id === org));
}

async function main() {
  assert.equal((await request('/api/transacciones')).status, 401);
  ok('Sin token: acceso rechazado');

  assert.equal((await request('/api/transacciones', 'invalido')).status, 403);
  ok('Token inválido: acceso rechazado');

  const badLogin = await request('/api/auth/login', null, {
    username: 'auditor',
    password: 'incorrecta',
  });
  assert.equal(badLogin.status, 401);
  ok('Contraseña incorrecta: login rechazado');

  const managerA = await login('gerente10');
  const auditorA = await login('auditor');
  const managerB = await login('gerenteB');
  const auditorB = await login('auditorB');

  await expectRows(managerA, [101], 1);
  ok('Gerente A: solo transacción 101');

  await expectRows(auditorA, [101, 102], 1);
  ok('Auditor A: ambas sucursales de su organización');

  await expectRows(managerB, [201], 2);
  ok('Gerente B: solo transacción 201');

  await expectRows(auditorB, [201, 202], 2);
  ok('Auditor B: ambas sucursales de su organización');

  const own = await request('/api/transacciones/101', managerA);
  assert.equal(own.status, 200);
  assert.equal(own.data.id, 101);
  assert.equal(own.data.organizacion_id, 1);
  ok('Consulta directa de transacción propia permitida');

  assert.equal((await request('/api/transacciones/201', managerA)).status, 404);
  ok('Gerente A no puede consultar el ID de organización B');

  assert.equal((await request('/api/transacciones/101', auditorB)).status, 404);
  ok('Auditor B no puede consultar el ID de organización A');

  assert.equal((await request('/api/transacciones/102', managerA)).status, 404);
  ok('Gerente A no puede consultar otra sucursal de su organización');

  await expectRows(
    managerA, [101], 1,
    '/api/transacciones?organizacion_id=2&role=auditor_regional'
  );
  ok('Parámetros manipulados no cambian los permisos');

  const injected = await login('gerente10', {
    organizacion_id: 2,
    role: 'auditor_regional',
    sucursalId: 5,
  });
  await expectRows(injected, [101], 1);
  ok('Campos adicionales en login no elevan privilegios');

  const parts = managerA.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  payload.sub = 'auditorB';
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(
    (await request('/api/transacciones', parts.join('.'))).status,
    403
  );
  ok('JWT con identidad manipulada rechazado');

  await expectRows(auditorB, [201, 202], 2);
  await expectRows(managerA, [101], 1);
  await expectRows(auditorA, [101, 102], 1);
  await expectRows(managerB, [201], 2);
  ok('Alternar identidades no mezcla los contextos de conexión');

  console.log(`\nRESULTADO: ${passed} comprobaciones aprobadas.`);
}

main().catch(error => {
  console.error('\nFALLO:', error.message);
  process.exitCode = 1;
});
