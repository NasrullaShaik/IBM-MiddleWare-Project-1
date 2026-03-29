const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return null;
  }
};

const getToken = (req) => req.headers.authorization?.replace('Bearer ', '');
const canMutate = (user) => user.is_selected === 1 && ['ADMIN', 'PUBLISHER'].includes(user.role);

const authUser = (req) => {
  const token = getToken(req);
  if (!token) return null;
  return db.getSessionUser(token);
};

const buildDiff = (oldApi, nextApi) => {
  const findings = [];
  if (oldApi.oauth_enabled === 1 && !nextApi.oauth_enabled) {
    findings.push({ severity: 'HIGH', message: 'OAuth is enabled in existing API but missing in new API.' });
  }

  const oldTargets = new Set((oldApi.backend_targets || '').split(',').map((v) => v.trim()).filter(Boolean));
  const newTargets = new Set((nextApi.backend_targets || '').split(',').map((v) => v.trim()).filter(Boolean));

  for (const target of oldTargets) {
    if (!newTargets.has(target)) findings.push({ severity: 'HIGH', message: `Backend target removed: ${target}` });
  }
  for (const target of newTargets) {
    if (!oldTargets.has(target)) findings.push({ severity: 'INFO', message: `Additional backend target added: ${target}` });
  }

  if (oldApi.version !== nextApi.version) findings.push({ severity: 'INFO', message: `Version changed from ${oldApi.version || 'N/A'} to ${nextApi.version || 'N/A'}` });
  return findings;
};

const serveStatic = (req, res) => {
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  reqPath = reqPath.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const map = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
  res.writeHead(200, { 'Content-Type': map[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const method = req.method;
    const url = req.url;

    if (method === 'GET' && url === '/api/bootstrap') {
      return json(res, 200, {
        users: db.listUsers(),
        roles: ['ADMIN', 'PUBLISHER', 'VIEWER'],
        catalogs: ['sandbox', 'test', 'production'],
        orgs: ['payments-org', 'retail-org', 'core-bank-org']
      });
    }

    if (method === 'POST' && url === '/api/login') {
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      const user = db.getUser(body.userId);
      if (!user || user.password !== body.password) return json(res, 401, { error: 'Invalid credentials' });

      const token = crypto.randomUUID();
      db.createSession(user.user_id, token);
      const generatedPassword = user.must_reset ? `Reset#${Math.random().toString(36).slice(2, 10)}` : null;
      return json(res, 200, {
        token,
        user: { userId: user.user_id, role: user.role, mustReset: Boolean(user.must_reset), isSelected: Boolean(user.is_selected) },
        generatedPassword
      });
    }

    if (method === 'POST' && url === '/api/reset-password') {
      const user = authUser(req);
      if (!user) return json(res, 401, { error: 'Invalid session' });
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      if (!body.newPassword || body.newPassword.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters' });
      db.updateUserPassword(user.user_id, body.newPassword);
      return json(res, 200, { message: 'Password reset successful' });
    }

    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'Invalid session' });

    if (method === 'GET' && url === '/api/dashboard') {
      return json(res, 200, { ...db.getCounts(), user, canMutate: canMutate(user) });
    }

    if (method === 'POST' && url === '/api/task1/request-access') {
      if (!canMutate(user)) return json(res, 403, { error: 'View-only access' });
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      const row = db.createApproval('TASK1_ACCESS', body, user.user_id);
      return json(res, 200, { id: row.id, status: row.status });
    }

    if (method === 'POST' && url === '/api/task2/prepare') {
      if (!canMutate(user)) return json(res, 403, { error: 'View-only access' });
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      const { apiName, org, catalog, version, oauthEnabled, backendTargets, swaggerText, productText } = body;
      if (!apiName || !org || !catalog) return json(res, 400, { error: 'apiName/org/catalog are required' });

      let swaggerJson = {};
      let productJson = {};
      try {
        swaggerJson = swaggerText ? JSON.parse(swaggerText) : {};
        productJson = productText ? JSON.parse(productText) : {};
      } catch {
        return json(res, 400, { error: 'Swagger/Product must be valid JSON' });
      }

      const nextApi = {
        api_name: apiName,
        org,
        catalog,
        version,
        oauth_enabled: oauthEnabled ? 1 : 0,
        backend_targets: backendTargets || '',
        swagger_json: swaggerJson,
        product_json: productJson
      };

      const oldApi = db.findLatestApi(apiName, org, catalog);
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

      const row = db.createApproval('TASK2_PUBLISH', { ...nextApi, findings }, user.user_id);
      return json(res, 200, { approvalId: row.id, findings });
    }

    if (method === 'POST' && url === '/api/task2/subscription') {
      if (!canMutate(user)) return json(res, 403, { error: 'View-only access' });
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });

      const payload = {
        org: body.org,
        catalog: body.catalog,
        consumerOrg: body.consumerOrg,
        appName: body.appName,
        productName: body.productName,
        clientId: `cid_${crypto.randomBytes(6).toString('hex')}`,
        clientSecret: `sec_${crypto.randomBytes(12).toString('hex')}`
      };
      const row = db.createApproval('TASK2_SUBSCRIBE', payload, user.user_id);
      return json(res, 200, { approvalId: row.id, clientId: payload.clientId, clientSecret: payload.clientSecret, message: 'Copy credentials now and save securely.' });
    }

    if (method === 'POST' && url === '/api/task3/certs') {
      if (!canMutate(user)) return json(res, 403, { error: 'View-only access' });
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      if (!body.certName || !body.expiresOn) return json(res, 400, { error: 'certName and expiresOn required' });
      db.addCert({ cert_name: body.certName, cert_type: body.certType || 'APIM', owner: body.owner || 'N/A', expires_on: body.expiresOn, notes: body.notes || '' });
      return json(res, 200, { message: 'Certificate recorded' });
    }

    if (method === 'GET' && url === '/api/task3/certs') {
      const today = new Date();
      const certs = db.listCerts().map((cert) => {
        const diffDays = Math.ceil((new Date(cert.expires_on) - today) / (1000 * 60 * 60 * 24));
        let alert = 'OK';
        if (diffDays <= 15) alert = '15_DAYS';
        else if (diffDays <= 30) alert = '1_MONTH';
        else if (diffDays <= 60) alert = '2_MONTHS';
        else if (diffDays <= 90) alert = '3_MONTHS';
        return { ...cert, daysLeft: diffDays, alert };
      });
      return json(res, 200, certs);
    }

    if (method === 'GET' && url === '/api/approvals') {
      return json(res, 200, db.listApprovals());
    }

    if (method === 'POST' && url.startsWith('/api/approvals/') && url.endsWith('/decision')) {
      if (user.role !== 'ADMIN') return json(res, 403, { error: 'Admin only' });
      const body = await parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      const id = Number(url.split('/')[3]);
      const approval = db.getApprovalById(id);
      if (!approval) return json(res, 404, { error: 'Approval not found' });
      if (approval.status !== 'PENDING') return json(res, 400, { error: 'Already processed' });

      db.decideApproval(id, body.decision, user.user_id);
      if (body.decision === 'APPROVED') {
        if (approval.task_type === 'TASK2_PUBLISH') {
          const { findings, ...apiPayload } = approval.payload;
          db.addApi(apiPayload, approval.requested_by);
        }
        if (approval.task_type === 'TASK2_SUBSCRIBE') {
          db.addSubscription({
            org: approval.payload.org,
            catalog: approval.payload.catalog,
            consumer_org: approval.payload.consumerOrg,
            app_name: approval.payload.appName,
            client_id: approval.payload.clientId,
            client_secret: approval.payload.clientSecret,
            product_name: approval.payload.productName
          }, approval.requested_by);
        }
      }
      return json(res, 200, { message: `Approval ${body.decision}` });
    }

    return json(res, 404, { error: 'Route not found' });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`IBM API Connect Workflow Portal running on http://localhost:${PORT}`);
});
