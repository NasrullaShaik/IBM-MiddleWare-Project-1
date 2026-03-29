# IBM API Connect Workflow Portal

This project now includes a working web portal for IBM API Connect admin operations with login controls, approval gates, API publish checks, subscription workflow, and certificate monitoring.

## Features mapped to your request

### Initial login + forced password reset
- User chooses a `userId` from the login dropdown.
- First successful login requires password reset.
- A generated temporary password is shown in popup and user is prompted to copy/save it and set a new one.

### T1 - Give Access to User in Org
- Form accepts target `userId`, multiple orgs, and role.
- Submission creates `PENDING` approval record.
- Only after admin approval does workflow move forward.

### T2 - API Publish + Subscription
- Detects whether API exists in selected Org + Catalog.
- Upload Swagger and Product JSON to draft.
- If existing:
  - Compares old vs new for OAuth and backend target changes.
  - Saves old API backup in `backups/` with timestamp.
  - Returns findings for popup display.
- Publish request goes through approval queue.
- Consumer app + subscription flow:
  - Supports org/catalog selection.
  - Generates clientId/clientSecret for new app and prompts user to copy.
  - Subscription enters approval queue.

### T3 - Certificate Monitoring
- Add APIM/DataPower cert records with expiry.
- Dashboard table classifies alerts at:
  - 3 months
  - 2 months
  - 1 month
  - 15 days
- Records are editable by adding refreshed cert entry with new expiry.

### View-only restriction
- Only selected users with role `ADMIN` / `PUBLISHER` can submit/publish.
- Non-selected users default to view-only mode and action buttons are disabled.

### Deploy anywhere (Local / Docker / OCP/K8s)
- Local: Node.js startup.
- Docker: included `Dockerfile`.
- OCP/K8s: included `kubernetes/deployment.yaml`.

---

## Tech stack
- Node.js (built-in HTTP server)
- JSON file persistence (`portal-data.json`)
- Vanilla HTML/CSS/JS frontend

## Quick start (Local)

```bash
node server.js
```

Open: `http://localhost:3000`

Default seeded users:
- `apic_admin` (ADMIN, selected)
- `publisher1` (PUBLISHER, selected)
- `viewer1` (VIEWER, view-only)

Default password: `Temp#1234` (first login forces reset)

## Docker

```bash
docker build -t ibm-apic-portal .
docker run --rm -p 3000:3000 ibm-apic-portal
```

## OCP / Kubernetes

```bash
kubectl apply -f kubernetes/deployment.yaml
```

> You mentioned deployment details via Excel or key:value input. This implementation is ready to extend with an ingestion endpoint for CSV/Excel or key-value parser in next iteration.

Persistence note: data is stored in `portal-data.json`, and the server uses Node.js built-in modules only (no external runtime dependencies), so it runs in restricted environments.
