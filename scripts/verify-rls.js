const BASE_URL =
  process.env.BASE_URL ||
  'https://zero-trust-api-financiera.vercel.app'

async function login(username, password) {
  const response = await fetch(
    `${BASE_URL}/api/auth/login`,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify({
        username,
        password,
      }),
    }
  )

  const data =
    await response.json()

  if (!response.ok) {
    throw new Error(
      `Login ${username}: ${JSON.stringify(data)}`
    )
  }

  if (!data.token) {
    throw new Error(
      `Login ${username}: token ausente`
    )
  }

  return data
}

async function transactions(token) {
  const response = await fetch(
    `${BASE_URL}/api/transacciones`,
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    }
  )

  const data =
    await response.json()

  if (!response.ok) {
    throw new Error(
      `Transacciones: ${JSON.stringify(data)}`
    )
  }

  return data
}

async function noTokenTest() {
  const response = await fetch(
    `${BASE_URL}/api/transacciones`
  )

  const data =
    await response.json()

  if (response.status !== 401) {
    throw new Error(
      `Esperaba 401 sin token; recibido ${response.status}`
    )
  }

  console.log(
    '✓ Endpoint protegido rechaza requests sin JWT'
  )

  console.log(
    `  Respuesta: ${data.error}`
  )
}

async function invalidTokenTest() {
  const response = await fetch(
    `${BASE_URL}/api/transacciones`,
    {
      headers: {
        Authorization:
          'Bearer token-invalido',
      },
    }
  )

  if (response.status !== 403) {
    throw new Error(
      `Esperaba 403 con JWT inválido; recibido ${response.status}`
    )
  }

  console.log(
    '✓ JWT inválido rechazado correctamente'
  )
}

async function gerenteTest() {
  const auth =
    await login(
      'gerente10',
      '1234'
    )

  console.log(
    `✓ Login gerente10 → rol=${auth.role}`
  )

  const result =
    await transactions(
      auth.token
    )

  const rows =
    result.transacciones || []

  const branches =
    [
      ...new Set(
        rows.map(
          row =>
            Number(
              row.sucursal_id
            )
        )
      ),
    ]

  const invalid =
    rows.filter(
      row =>
        Number(
          row.sucursal_id
        ) !== 10
    )

  if (invalid.length > 0) {
    throw new Error(
      `RLS VIOLATION: gerente10 recibió ${invalid.length} registros de otra sucursal`
    )
  }

  console.log(
    `✓ RLS gerente10: ${rows.length} registros`
  )

  console.log(
    `✓ Sucursales visibles: ${branches.join(', ')}`
  )

  console.log(
    '✓ Ningún registro fuera de sucursal 10'
  )
}

async function auditorTest() {
  const auth =
    await login(
      'auditor',
      'admin'
    )

  console.log(
    `✓ Login auditor → rol=${auth.role}`
  )

  const result =
    await transactions(
      auth.token
    )

  const rows =
    result.transacciones || []

  const branches =
    [
      ...new Set(
        rows.map(
          row =>
            Number(
              row.sucursal_id
            )
        )
      ),
    ].sort(
      (a, b) => a - b
    )

  console.log(
    `✓ Auditor recibió ${rows.length} registros`
  )

  console.log(
    `✓ Sucursales visibles: ${branches.join(', ')}`
  )

  if (
    branches.length > 1
  ) {
    console.log(
      '✓ RLS auditor regional permite visibilidad multi-sucursal'
    )
  } else {
    console.warn(
      '⚠ Auditor solo recibió una sucursal. Revisar si el dataset tiene otras sucursales o si la política RLS debe ampliarse.'
    )
  }
}

async function main() {
  console.log(
    '\nZERO-TRUST RLS SECURITY VERIFICATION'
  )

  console.log(
    `Target: ${BASE_URL}\n`
  )

  await noTokenTest()
  await invalidTokenTest()

  console.log(
    '\n--- GERENTE SUCURSAL 10 ---'
  )

  await gerenteTest()

  console.log(
    '\n--- AUDITOR REGIONAL ---'
  )

  await auditorTest()

  console.log(
    '\n================================'
  )

  console.log(
    'ZERO-TRUST SECURITY TESTS: OK'
  )

  console.log(
    '================================\n'
  )
}

main().catch(
  error => {
    console.error(
      '\nSECURITY TEST FAILED'
    )

    console.error(
      error.message
    )

    process.exit(1)
  }
)
