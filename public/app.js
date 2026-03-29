const state = {
  token: null,
  user: null,
  bootstrap: null
};

const el = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function disableForViewOnly(canMutate) {
  ['t1Submit', 'draftPublishBtn', 'subscriptionBtn', 'certSaveBtn'].forEach((id) => {
    el(id).disabled = !canMutate;
  });
}

function renderStats(data) {
  el('stats').innerHTML = `
    <div class="card"><strong>User</strong><div>${data.user.user_id}</div></div>
    <div class="card"><strong>Role</strong><div>${data.user.role}</div></div>
    <div class="card"><strong>Pending Approvals</strong><div>${data.pendingCount}</div></div>
    <div class="card"><strong>Published APIs</strong><div>${data.apiCount}</div></div>
  `;
}

async function loadBootstrap() {
  const boot = await api('/api/bootstrap');
  state.bootstrap = boot;
  el('userId').innerHTML = boot.users.map((u) => `<option value="${u.user_id}">${u.user_id} (${u.role}${u.is_selected ? ', selected' : ', view-only'})</option>`).join('');
  el('apiOrg').innerHTML = boot.orgs.map((o) => `<option>${o}</option>`).join('');
  el('apiCatalog').innerHTML = boot.catalogs.map((c) => `<option>${c}</option>`).join('');
}

async function refreshDashboard() {
  const data = await api('/api/dashboard');
  renderStats(data);
  disableForViewOnly(data.canMutate);
}

async function refreshApprovals() {
  const approvals = await api('/api/approvals');
  const box = el('approvals');
  box.innerHTML = approvals.map((a) => `
    <div class="approval">
      <div><strong>#${a.id}</strong> ${a.task_type} - ${a.status}</div>
      <div>Requested by ${a.requested_by}</div>
      <pre>${JSON.stringify(a.payload, null, 2)}</pre>
      ${a.status === 'PENDING' && state.user.role === 'ADMIN' ? `
        <button onclick="decide(${a.id}, 'APPROVED')">Approve</button>
        <button onclick="decide(${a.id}, 'REJECTED')">Reject</button>
      ` : ''}
    </div>
  `).join('');
}

async function refreshCerts() {
  const certs = await api('/api/task3/certs');
  el('certTable').querySelector('tbody').innerHTML = certs.map((c) => `
    <tr>
      <td>${c.cert_name}</td>
      <td>${c.cert_type}</td>
      <td>${c.owner}</td>
      <td>${c.expires_on}</td>
      <td>${c.daysLeft}</td>
      <td><span class="tag ${c.alert}">${c.alert}</span></td>
    </tr>
  `).join('');
}

window.decide = async (id, decision) => {
  try {
    await api(`/api/approvals/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    await Promise.all([refreshDashboard(), refreshApprovals(), refreshCerts()]);
  } catch (e) {
    alert(e.message);
  }
};

el('loginBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: el('userId').value, password: el('password').value })
    });

    state.token = data.token;
    state.user = data.user;

    if (data.user.mustReset) {
      const promptMessage = `Temporary generated password: ${data.generatedPassword}\nCopy this password and set your own now (min 8 chars).`;
      const next = window.prompt(promptMessage, data.generatedPassword);
      if (next) {
        await api('/api/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: next })
        });
        alert('Password reset complete. Use this password for next login.');
      }
    }

    el('loginCard').classList.add('hidden');
    el('portal').classList.remove('hidden');
    await Promise.all([refreshDashboard(), refreshApprovals(), refreshCerts()]);
  } catch (e) {
    alert(e.message);
  }
});

el('t1Submit').addEventListener('click', async () => {
  try {
    const orgs = el('t1Orgs').value.split(',').map((s) => s.trim()).filter(Boolean);
    await api('/api/task1/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: el('t1UserId').value, orgs, role: el('t1Role').value })
    });
    alert('Access request submitted for approval');
    await refreshApprovals();
  } catch (e) {
    alert(e.message);
  }
});

el('draftPublishBtn').addEventListener('click', async () => {
  try {
    const fd = new FormData();
    fd.append('apiName', el('apiName').value);
    fd.append('org', el('apiOrg').value);
    fd.append('catalog', el('apiCatalog').value);
    fd.append('version', el('apiVersion').value);
    fd.append('backendTargets', el('apiBackends').value);
    fd.append('oauthEnabled', String(el('apiOauth').checked));

    if (el('swaggerFile').files[0]) fd.append('swagger', el('swaggerFile').files[0]);
    if (el('productFile').files[0]) fd.append('product', el('productFile').files[0]);

    const data = await api('/api/task2/prepare', { method: 'POST', body: fd });
    const lines = data.findings.map((f) => `- [${f.severity}] ${f.message}`).join('\n');
    alert(`Draft completed. Changes detected:\n${lines}\n\nPublish request sent for approval.`);
    await refreshApprovals();
  } catch (e) {
    alert(e.message);
  }
});

el('subscriptionBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/task2/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org: el('apiOrg').value,
        catalog: el('apiCatalog').value,
        consumerOrg: el('consumerOrg').value,
        appName: el('appName').value,
        productName: el('productName').value
      })
    });

    alert(`App credentials generated.\nClient ID: ${data.clientId}\nClient Secret: ${data.clientSecret}\nCopy now and store securely.`);
    await refreshApprovals();
  } catch (e) {
    alert(e.message);
  }
});

el('certSaveBtn').addEventListener('click', async () => {
  try {
    await api('/api/task3/certs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        certName: el('certName').value,
        certType: el('certType').value,
        owner: el('certOwner').value,
        expiresOn: el('certExpiry').value,
        notes: el('certNotes').value
      })
    });
    await refreshCerts();
  } catch (e) {
    alert(e.message);
  }
});

loadBootstrap().catch((e) => alert(e.message));
