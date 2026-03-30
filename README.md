# IBM API Connect Workflow Portal

This project now contains a dynamic web experience for IBM API Connect operations with approval workflows.

## Current focus delivered (Module 1 refined)

### Dynamic/Styled UX
- Modern glass-style UI theme and dashboard cards.
- Toast notifications and modal popups for operation output.
- CLI-style step timeline to show exactly what happened during execution.

### Task 1 (Provider Org user access) mapped from your bash script
The Task1 UI now models the same flow as your CLI script:
1. APIC login command preview
2. Provider org selection validation
3. Role selection
4. LDAP user existence check
5. User creation when absent
6. User URL resolution
7. Org membership check
8. Member create/update with selected role

Every run stores the output as an approval request (`TASK1_ACCESS`) and shows step-by-step logs in the interface.

## Quick start

```bash
node server.js
```

Open: `http://localhost:3000`

Default users:
- `apic_admin / Temp#1234`
- `publisher1 / Temp#1234`
- `viewer1 / Temp#1234` (view-only)

## Notes
- Data persistence uses local JSON file: `portal-data.json`.
- This phase intentionally perfects Task1 UI + CLI-like behavior first, before moving to the next modules.
