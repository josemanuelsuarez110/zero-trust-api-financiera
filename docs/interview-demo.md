# Interview demonstration

## Goal and scope

Show a complete application security case in about three minutes: permitted access, blocked cross-organization access, correlated audit evidence and automated verification. This is a personal laboratory with synthetic data, not a client engagement or an incident in production.

## Preparation

Complete [the local setup guide](tenant-isolation.md). Use two terminals from the repository root. Do not display .env.lab, browser passwords or authentication tokens while recording.

Terminal A, unless the server is already running with this capture:
```bash
mkdir -p logs
set -o pipefail
node scripts/lab-server.js 2>&1 | tee -a logs/security-session.log
```

Terminal B:
```bash
node scripts/demo-security.js
node scripts/verify-lab.js && node scripts/verify-audit.js
```

The demonstration must end with DEMO PASSED. The suites should report 15 API checks and 6 audit checks. The 6 SQL checks are separate and are also exercised in CI. Stop and investigate any failure; do not present an expected result as an observed result.

## Three minute walkthrough

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:30 | Repository and fixture description | Two organizations share branch number 10. A branch filter alone is insufficient. |
| 0:30–1:15 | Run demo-security.js | User gerente10 can read transaction 101 but receives 404 for transaction 201. |
| 1:15–1:50 | Audit evidence printed by the script | Match each request ID to its event. Explain why 404 is resource unavailable rather than proof of attack. |
| 1:50–2:30 | Run the API and audit suites | Show their actual summaries and the CI result for the current commit. |
| 2:30–3:00 | SQL policy and limitations | Explain restrictive tenant scope, permitted role scope and trusted server context. |

## Suggested English narration

“I built this local financial API laboratory to demonstrate tenant isolation and security testing. The dataset contains two organizations that share the same branch numbers, so checking the branch alone would not be sufficient.

First, I authenticate as a manager in organization one. The API allows access to transaction 101. With the same identity, I request transaction 201, which belongs to organization two. The response is 404 and contains no transaction data.

The API resolves organization and role from a server-side identity mapping after verifying the JWT. PostgreSQL row-level security applies the organization boundary and the role-based branch rules within a transaction.

Each response has a request ID. The demonstration matches that ID to its audit event, allowing me to connect an API result with the authenticated identity and organization. A 404 by itself does not prove malicious activity; here, the controlled fixture tells us the requested record belongs to another organization.

During development, I found that some authentication rejections were absent from the logs because the logger read the request path after mounted middleware had processed it. Capturing the original path corrected that issue, and I added regression checks for the audit events.

The project has six SQL checks, fifteen API checks and six audit checks, with automated execution against disposable PostgreSQL in GitHub Actions. It uses demo authentication and does not establish production readiness, multi-connection concurrency safety or protection against stolen database credentials.”

## Questions to prepare for

- Why use 404? It avoids revealing whether a particular foreign transaction exists; the fixture, not the log alone, establishes what was tested.
- Why transaction-local context? It scopes the organization and role settings to the current database transaction. Sequential reuse and concurrent HTTP requests are tested with a one-connection pool; multiple database connections are not yet covered.
- Can the database login change organization context? Yes. It is a trusted application credential. RLS here is not a defense against its compromise.
- What did you actually fix? An audit visibility defect and verification scripts that could previously accept insufficient evidence. No production cross-tenant vulnerability was established.
- What is next? Extend regression coverage and review identity lifecycle, concurrency and write authorization before considering production use.

Use this narration only after rehearsing the commands and understanding the code. Separate tools and AI assistance from decisions and results you can personally explain.
