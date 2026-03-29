const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const parseMaybeJson = (input) => {
  if (!input) return {};
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
};

const getToken = (req) => req.headers.authorization?.replace('Bearer ', '');

const auth = (req, res, next) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  const user = db.prepare('SELECT user_id, role, must_reset, is_selected FROM users WHERE user_id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user = user;
  req.token = token;
  next();
};

const canMutate = (user) => user.is_selected === 1 && ['ADMIN', 'PUBLISHER'].includes(user.role);

const buildDiff = (oldApi, nextApi) => {
  const findings = [];

  if (oldApi.oauth_enabled === 1 && !nextApi.oauth_enabled) {
    findings.push({ severity: 'HIGH', message: 'OAuth is enabled in existing API but missing in new API.' });
  }

  const oldTargets = new Set((oldApi.backend_targets || '').split(',').map((v) => v.trim()).filter(Boolean));
  const newTargets = new Set((nextApi.backend_targets || '').split(',').map((v) => v.trim()).filter(Boolean));

  for (const target of oldTargets) {
    if (!newTargets.has(target)) {
      findings.push({ severity: 'HIGH', message: `Backend target removed: ${target}` });
    }
  }

  for (const target of newTargets) {
    if (!oldTargets.has(target)) {
      findings.push({ severity: 'INFO', message: `Additional backend target added: ${target}` });
    }
  }

  if (oldApi.version !== nextApi.version) {
    findings.push({ severity: 'INFO', message: `Version changed from ${oldApi.version || 'N/A'} to ${nextApi.version || 'N/A'}` });
  }

  return findings;
};

app.get('/api/bootstrap', (req, res) => {
  const users = db.prepare('SELECT user_id, role, is_selected FROM users').all();
  res.json({
    users,
    roles: ['ADMIN', 'PUBLISHER', 'VIEWER'],
    catalogs: ['sandbox', 'test', 'production'],
    orgs: ['payments-org', 'retail-org', 'core-bank-org']
  });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.user_id, new Date().toISOString());

  const tempPassword = user.must_reset ? `Reset#${Math.random().toString(36).slice(2, 10)}` : null;

  res.json({
    token,
    user: {
      userId: user.user_id,
      role: user.role,
      mustReset: Boolean(user.must_reset),
      isSelected: Boolean(user.is_selected)
    },
    generatedPassword: tempPassword
  });
});

app.post('/api/reset-password', auth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  db.prepare('UPDATE users SET password = ?, must_reset = 0 WHERE user_id = ?').run(newPassword, req.user.user_id);
  res.json({ message: 'Password reset successful' });
});

app.post('/api/task1/request-access', auth, (req, res) => {
  if (!canMutate(req.user)) return res.status(403).json({ error: 'View-only access' });
  const { userId, orgs, role } = req.body;
  const payload = { userId, orgs, role };
  const now = new Date().toISOString();

  const result = db.prepare(`INSERT INTO approvals (task_type, payload, status, requested_by, created_at, updated_at)
    VALUES ('TASK1_ACCESS', ?, 'PENDING', ?, ?, ?)`)
    .run(JSON.stringify(payload), req.user.user_id, now, now);

  res.json({ id: result.lastInsertRowid, status: 'PENDING' });
});

app.post('/api/task2/prepare', auth, upload.fields([{ name: 'swagger', maxCount: 1 }, { name: 'product', maxCount: 1 }]), (req, res) => {
  if (!canMutate(req.user)) return res.status(403).json({ error: 'View-only access' });

  const { apiName, org, catalog, version, oauthEnabled, backendTargets } = req.body;
  if (!apiName || !org || !catalog) return res.status(400).json({ error: 'apiName/org/catalog are required' });

  let swaggerJson = {};
  let productJson = {};
  try {
    swaggerJson = req.files?.swagger?.[0] ? JSON.parse(req.files.swagger[0].buffer.toString('utf-8')) : {};
    productJson = req.files?.product?.[0] ? JSON.parse(req.files.product[0].buffer.toString('utf-8')) : {};
  } catch {
    return res.status(400).json({ error: 'Swagger/Product must be valid JSON' });
  }

  const oldApi = db.prepare('SELECT * FROM api_registry WHERE api_name = ? AND org = ? AND catalog = ? ORDER BY id DESC LIMIT 1')
    .get(apiName, org, catalog);

  const nextApi = {
    api_name: apiName,
    org,
    catalog,
    version,
    oauth_enabled: oauthEnabled === 'true' ? 1 : 0,
    backend_targets: backendTargets || ''
  };

  let findings = [];
  if (oldApi) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `${apiName}_${org}_${catalog}_${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(oldApi, null, 2));
    findings = buildDiff(oldApi, nextApi);
    findings.push({ severity: 'INFO', message: `Backup saved: ${backupPath}` });
  } else {
    findings.push({ severity: 'INFO', message: 'New API detected. No previous version found.' });
  }

  const payload = {
    ...nextApi,
    swagger_json: swaggerJson,
    product_json: productJson,
    findings
  };

  const now = new Date().toISOString();
  const request = db.prepare(`INSERT INTO approvals (task_type, payload, status, requested_by, created_at, updated_at)
    VALUES ('TASK2_PUBLISH', ?, 'PENDING', ?, ?, ?)`)
    .run(JSON.stringify(payload), req.user.user_id, now, now);

  res.json({ approvalId: request.lastInsertRowid, findings });
});

app.post('/api/task2/subscription', auth, (req, res) => {
  if (!canMutate(req.user)) return res.status(403).json({ error: 'View-only access' });
  const { org, catalog, consumerOrg, appName, productName } = req.body;

  const clientId = `cid_${crypto.randomBytes(6).toString('hex')}`;
  const clientSecret = `sec_${crypto.randomBytes(12).toString('hex')}`;

  const payload = {
    org,
    catalog,
    consumerOrg,
    appName,
    productName,
    clientId,
    clientSecret
  };

  const now = new Date().toISOString();
  const request = db.prepare(`INSERT INTO approvals (task_type, payload, status, requested_by, created_at, updated_at)
    VALUES ('TASK2_SUBSCRIBE', ?, 'PENDING', ?, ?, ?)`)
    .run(JSON.stringify(payload), req.user.user_id, now, now);

  res.json({
    approvalId: request.lastInsertRowid,
    clientId,
    clientSecret,
    message: 'Copy credentials now and save securely.'
  });
});

app.post('/api/task3/certs', auth, (req, res) => {
  if (!canMutate(req.user)) return res.status(403).json({ error: 'View-only access' });
  const { certName, certType, owner, expiresOn, notes } = req.body;
  if (!certName || !expiresOn) return res.status(400).json({ error: 'certName and expiresOn required' });

  const now = new Date().toISOString();
  db.prepare('INSERT INTO certs (cert_name, cert_type, owner, expires_on, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(certName, certType || 'APIM', owner || 'N/A', expiresOn, notes || '', now);

  res.json({ message: 'Certificate recorded' });
});

app.get('/api/task3/certs', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM certs ORDER BY date(expires_on) ASC').all();
  const today = new Date();

  const enriched = rows.map((cert) => {
    const diffDays = Math.ceil((new Date(cert.expires_on) - today) / (1000 * 60 * 60 * 24));
    let alert = 'OK';
    if (diffDays <= 15) alert = '15_DAYS';
    else if (diffDays <= 30) alert = '1_MONTH';
    else if (diffDays <= 60) alert = '2_MONTHS';
    else if (diffDays <= 90) alert = '3_MONTHS';

    return { ...cert, daysLeft: diffDays, alert };
  });

  res.json(enriched);
});

app.get('/api/approvals', auth, (req, res) => {
  const approvals = db.prepare('SELECT * FROM approvals ORDER BY id DESC').all();
  res.json(approvals.map((a) => ({ ...a, payload: parseMaybeJson(a.payload) })));
});

app.post('/api/approvals/:id/decision', auth, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const id = Number(req.params.id);
  const { decision } = req.body;
  const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Already processed' });

  const now = new Date().toISOString();
  db.prepare('UPDATE approvals SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?')
    .run(decision, req.user.user_id, now, id);

  if (decision === 'APPROVED') {
    const payload = parseMaybeJson(approval.payload);
    if (approval.task_type === 'TASK2_PUBLISH') {
      db.prepare(`INSERT INTO api_registry (api_name, org, catalog, version, swagger_json, product_json, oauth_enabled, backend_targets, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(payload.api_name, payload.org, payload.catalog, payload.version || '', JSON.stringify(payload.swagger_json || {}), JSON.stringify(payload.product_json || {}), payload.oauth_enabled || 0, payload.backend_targets || '', approval.requested_by, now);
    }

    if (approval.task_type === 'TASK2_SUBSCRIBE') {
      db.prepare(`INSERT INTO subscriptions (org, catalog, consumer_org, app_name, client_id, client_secret, product_name, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
        .run(payload.org, payload.catalog, payload.consumerOrg, payload.appName, payload.clientId, payload.clientSecret, payload.productName, approval.requested_by, now);
    }
  }

  res.json({ message: `Approval ${decision}` });
});

app.get('/api/dashboard', auth, (req, res) => {
  const apiCount = db.prepare('SELECT COUNT(*) c FROM api_registry').get().c;
  const pendingCount = db.prepare(`SELECT COUNT(*) c FROM approvals WHERE status = 'PENDING'`).get().c;
  const subCount = db.prepare('SELECT COUNT(*) c FROM subscriptions').get().c;
  const certCount = db.prepare('SELECT COUNT(*) c FROM certs').get().c;

  res.json({ apiCount, pendingCount, subCount, certCount, user: req.user, canMutate: canMutate(req.user) });
});

app.listen(PORT, () => {
  console.log(`IBM API Connect Workflow Portal running on http://localhost:${PORT}`);
});
