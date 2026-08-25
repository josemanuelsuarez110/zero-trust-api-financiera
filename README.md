# Zero Trust API Financiera

Security-focused financial API demonstrating JWT authentication, role context injection and PostgreSQL Row-Level Security (RLS).

## Architecture

Browser
   |
   v
Express API
   |
   +-- JWT verification
   +-- Role / branch context
   |
   v
PostgreSQL / Neon
   |
   +-- SET LOCAL ROLE dummy_test
   +-- Row-Level Security
   |
   v
Authorized rows only

## Stack

- Node.js
- Express
- PostgreSQL
- Neon Serverless
- JSON Web Tokens
- PostgreSQL Row-Level Security
- Vanilla HTML / JavaScript demo UI
- Vercel Serverless Functions

## Security Model

1. Every protected request requires a JWT.
2. JWT identity and role are verified by the API.
3. Role context is injected into PostgreSQL.
4. PostgreSQL RLS decides which rows are visible.
5. Authorization is enforced at the database layer.

## Demo identities

These accounts exist only for portfolio/testing purposes.

| User | Password | Role |
| --- | --- | --- |
| gerente10 | 1234 | gerente_sucursal |
| auditor | admin | auditor_regional |
| cajero5 | 123 | cajero |
| cliente | pass | cliente |

Do not use this mock authentication model for real production accounts.

## Required environment variables

DATABASE_URL
JWT_SECRET

Never commit their values to Git.

## Automated Security Verification

Run:

npm run test:security

The test validates:

- HTTP 401 when JWT is missing
- HTTP 403 when JWT is invalid
- branch manager restricted to branch 10
- regional auditor receives multi-branch access
- PostgreSQL RLS enforced end-to-end

## Production

https://zero-trust-api-financiera.vercel.app

Health endpoint:

/api/health

Expected response:

{
  "ok": true,
  "jwtConfigured": true,
  "databaseConfigured": true
}

## Security Note

This repository is a portfolio security laboratory. Authentication identities are intentionally mocked to demonstrate authorization and PostgreSQL RLS.

A real production implementation should add a real identity provider, password hashing, rate limiting, account lifecycle controls and centralized security audit logging.
