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

## Reproduction from a fresh Linux environment

These instructions target Ubuntu 24.04 or Linux Mint 22 with Node.js 24, npm, Git and Python 3 available. The lab uses PostgreSQL 16 at 127.0.0.1:5432 and HTTP at 127.0.0.1:3001. It needs no production credentials or cloud database. Docker is not required locally.

### Get the code and dependencies
```bash
git clone --branch security/tenant-isolation https://github.com/josemanuelsuarez110/zero-trust-api-financiera.git
cd zero-trust-api-financiera
node --version
npm ci
sudo apt update
sudo apt install postgresql-16 postgresql-client-16
pg_lsclusters
```
Confirm PostgreSQL 16 is online on port 5432. If the 16/main cluster exists but is down, run `sudo pg_ctlcluster 16 main start`. If ports or cluster names differ, resolve that before continuing. For an existing checkout, switch to the lab branch instead of cloning again.

### Create the dedicated database
Run this only for a fresh lab. These commands intentionally fail if the role or database already exists; do not drop an existing database to resolve that error.
```bash
sudo -u postgres psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE zt_lab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE zt_security_lab;
REVOKE ALL ON DATABASE zt_security_lab FROM PUBLIC;
GRANT CONNECT ON DATABASE zt_security_lab TO zt_lab_app;
SQL
sudo -u postgres psql -X -c '\password zt_lab_app'
```
Choose a local-only database password at the hidden prompts. The database administrator owns the tables; the application user must not own them.

### Apply fixtures and verify SQL isolation
```bash
sudo -u postgres psql -X -d zt_security_lab -v ON_ERROR_STOP=1 < sql/001_lab_isolation.sql
psql -X -h 127.0.0.1 -p 5432 -U zt_lab_app -d zt_security_lab -W -v ON_ERROR_STOP=1 -f sql/002_verify_isolation.sql
```
The setup ends with COMMIT. Verification emits six OK notices and ends with ROLLBACK, which clears temporary test context. The fixture script is not a repeatable migration; apply it once to the fresh database.

### Create local configuration
Run from the repository root. This prompts for the database password, percent-encodes it in the connection URL, generates a separate JWT secret and creates a file readable only by its owner. It refuses to overwrite an existing file.
```bash
python3 - <<'PY'
from pathlib import Path
from getpass import getpass
from urllib.parse import quote
import os
import secrets
target = Path('.env.lab')
if target.exists():
    raise SystemExit('.env.lab already exists; left unchanged')
password = getpass('Password for zt_lab_app: ')
if not password:
    raise SystemExit('Empty password; no file created')
url = 'postgresql://zt_lab_app:' + quote(password, safe='') + '@127.0.0.1:5432/zt_security_lab'
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('NODE_ENV=development\nLAB_MODE=true\nPORT=3001\n')
    output.write('DATABASE_URL=' + url + '\n')
    output.write('JWT_SECRET=' + secrets.token_hex(32) + '\n')
print('Local configuration created; credentials not displayed')
PY
git check-ignore .env.lab logs/security-session.log
```
Both paths should be ignored. Never commit the configuration or paste its contents into reports. The lab loads `.env.lab` explicitly; it does not use the published application's `.env`. Its HTTP listener is fixed to port 3001.

### Run the server and checks
In terminal A, from the repository root:
```bash
mkdir -p logs
set -o pipefail
node scripts/lab-server.js 2>&1 | tee -a logs/security-session.log
```
Wait for `Laboratorio listo: http://127.0.0.1:3001`.
In terminal B, from the same repository root:
```bash
set -o pipefail
node scripts/verify-lab.js 2>&1 | tee logs/verification.txt
node scripts/verify-audit.js 2>&1 | tee logs/audit-verification.txt
```
Expect 15 HTTP checks and 6 audit checks to pass. Combined with the SQL suite, this is 27 checks, not 27 distinct vulnerabilities. Audit verification correlates fresh request IDs, so old log entries cannot satisfy the current requests.

| Lab identity | Organization | Scope |
| --- | --- | --- |
| gerente10 | 1 | Branch 10, transaction 101 |
| auditor | 1 | Transactions 101 and 102 |
| gerenteB | 2 | Branch 10, transaction 201 |
| auditorB | 2 | Transactions 201 and 202 |

All four HTTP demo identities use `demo-lab-only`. This is unrelated to the PostgreSQL password. There is no browser UI for this lab; the scripts exercise the API directly.

### Troubleshooting and shutdown
- Database connection failure: confirm `pg_lsclusters`, the database name and password using `psql -h 127.0.0.1 -U zt_lab_app -d zt_security_lab -W`. Do not print the connection URL.
- Port 3001 occupied: stop the previous lab server with Ctrl+C; avoid starting duplicate servers.
- Missing audit log: start the server using the capture command above and run checks from the repository root.
- Existing tables: skip fixture creation if this is the already initialized lab; investigate unexpected data rather than deleting it blindly.
- Stop terminal A with Ctrl+C when finished. The database and local logs remain for later sessions; restarting the lab does not require recreating them.

### Continuous integration
`.github/workflows/security-lab.yml` provisions disposable PostgreSQL 16, creates the restricted role, applies fixtures and runs all three suites with Node.js 24. CI uses disposable credentials, not local or production secrets. It runs on pushes to `security/tenant-isolation` and pull requests. It does not deploy the application.

## Limitations
Authentication uses fixed demo identities and a demo password.
Database credentials are trusted server credentials: their holder
can change the session context. These checks do not demonstrate
protection against stolen database credentials or SQL injection.
The tests do not cover multiple simultaneous database connections,
token revocation, write operations or production deployment.
No vulnerability in the published application was established.

## Automated audit event verification
Validated on 2026-10-04: six audit checks passed.

Run the laboratory server with captured output:
node scripts/lab-server.js 2>&1 | tee -a logs/security-session.log

In a separate terminal:
node scripts/verify-audit.js

Each check correlates a fresh HTTP response's X-Request-ID
with exactly one recorded event. It verifies event type,
HTTP status, method, route, identity, organization, role,
timestamp format and the allowed set of log fields.

Covered cases:
- Missing and invalid authentication tokens.
- Rejected and successful login.
- Unavailable transaction from another organization.
- Successful transaction listing.

This regression test detects missing or incorrectly attributed
events, including the previously corrected request-path issue.
It does not establish log tamper resistance or centralized retention.

## Concurrent HTTP requests

On 2026-10-04, the local concurrency test passed 40 requests in
five batches of eight simultaneous HTTP requests across four identities.
Each response matched the expected transaction IDs and organization,
and all 40 response request IDs were distinct.

Run with the laboratory server active:
node scripts/verify-concurrency.js

The database pool has one connection, so database transactions are
serialized. This validates the tested HTTP overlap and connection reuse;
it is not a multi-connection isolation test or a performance benchmark.

## Configurable connection pool
The local laboratory accepts LAB_POOL_MAX from 1 to 4,
with a default of 1.

To run with a maximum of four connections:
LAB_POOL_MAX=4 node scripts/lab-server.js 2>&1 | tee -a logs/security-session.log

On 2026-10-04, the local run with this configuration passed
40 concurrent HTTP requests and six audit correlation checks.
A subsequent PostgreSQL snapshot showed four idle connections.
This snapshot does not establish simultaneous query execution.

GitHub Actions is configured to run the security suite in
separate jobs with pool limits of 1 and 4. Each job uses its
own PostgreSQL service and synthetic fixtures.
These checks validate the tested isolation scenarios;
they are not a load benchmark.
