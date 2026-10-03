# Tenant isolation security case study

## Scope
Local financial API laboratory using synthetic transactions,
Express, JWT authentication and PostgreSQL row-level security.

## Access rules
- Managers can read only their organization's assigned branch.
- Auditors can read all branches within their own organization.
- Missing context and unknown roles cannot read transactions.
- Tenant and role parameters supplied by HTTP clients do not
  override the server-side identity mapping.

## Validation
Six SQL checks and fifteen HTTP checks passed on 2026-10-03.

The HTTP checks cover legitimate access, cross-organization
access by ID, cross-branch access, invalid authentication,
query and login-field manipulation, JWT payload tampering,
and sequential connection reuse across identities.

## Reproduction
Apply sql/001_lab_isolation.sql to the dedicated laboratory
database as its administrator.

Run sql/002_verify_isolation.sql as zt_lab_app.

With PostgreSQL running and .env.lab configured:
1. Start: node scripts/lab-server.js
2. In another terminal: node scripts/verify-lab.js

The database setup script is intended for a fresh lab database.

## Limitations
Authentication uses fixed demo identities and a demo password.
Database credentials are trusted server credentials: their holder
can change the session context. These checks do not demonstrate
protection against stolen database credentials or SQL injection.
The tests do not cover concurrent requests, token revocation,
write operations or production deployment.
No vulnerability in the published application was established.
