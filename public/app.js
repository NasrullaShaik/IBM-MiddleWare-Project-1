const state = {
  token: null,
  user: null,
  bootstrap: null
};

const el = (id) => document.getElementById(id);

const toast = (message) => {
  const t = el('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
};

const showModal = (title, body) => {
  el('modalTitle').textContent = title;
  el('modalBody').textContent = body;
  el('modal').classList.remove('hidden');
};

el('closeModal').addEventListener('click', () => el('modal').classList.add('hidden'));

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function disableForViewOnly(canMutate) {
  el('task1RunBtn').disabled = !canMutate;
}

function renderStats(data) {
  el('stats').innerHTML = `
    <div class="stat-tile">User<b>${data.user.user_id}</b></div>
    <div class="stat-tile">Role<b>${data.user.role}</b></div>
    <div class="stat-tile">Pending Approvals<b>${data.pendingCount}</b></div>
    <div class="stat-tile">Mode<b>${data.canMutate ? 'EXECUTE' : 'VIEW-ONLY'}</b></div>
  `;
}

function renderTask1Timeline(logs = []) {
  const container = el('task1Timeline');
  if (!logs.length) {
    container.innerHTML = '<p class="hint">Run workflow to view CLI-style execution timeline.</p>';
    return;
  }

  container.innerHTML = logs.map((row) => `
    <div class="step ${row.status}">
      <div><b>${row.step}</b> - ${row.message}</div>
      ${row.command ? `<div class="meta">${row.command}</div>` : ''}
    </div>
  `).join('');
}

async function loadBootstrap() {
  const boot = await api('/api/bootstrap');
  state.bootstrap = boot;

  el('userId').innerHTML = boot.users
    .map((u) => `<option value="${u.user_id}">${u.user_id} (${u.role}${u.is_selected ? ', selected' : ', view-only'})</option>`)
    .join('');

  el('providerOrg').innerHTML = boot.orgs.map((o) => `<option value="${o}">${o}</option>`).join('');
  el('task1Role').innerHTML = boot.task1Roles.map((r) => `<option value="${r}">${r}</option>`).join('');
}

async function refreshDashboard() {
  const data = await api('/api/dashboard');
  renderStats(data);
  disableForViewOnly(data.canMutate);
}

async function refreshApprovals() {
  const approvals = await api('/api/approvals');
  const box = el('approvals');

  box.innerHTML = approvals.slice(0, 8).map((a) => `
    <div class="approval">
      <div><b>#${a.id}</b> ${a.task_type} - ${a.status}</div>
      <div class="meta">Requested by ${a.requested_by}</div>
      <button onclick="showApproval(${a.id})">View payload</button>
      ${a.status === 'PENDING' && state.user.role === 'ADMIN' ? `
        <button onclick="decide(${a.id}, 'APPROVED')">Approve</button>
        <button onclick="decide(${a.id}, 'REJECTED')">Reject</button>
      ` : ''}
    </div>
  `).join('');

  window._approvals = approvals;
}

window.showApproval = (id) => {
  const row = (window._approvals || []).find((a) => a.id === id);
  if (!row) return;
  showModal(`Approval #${id}`, JSON.stringify(row.payload, null, 2));
};

window.decide = async (id, decision) => {
  try {
    await api(`/api/approvals/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    toast(`Approval ${decision}`);
    await Promise.all([refreshDashboard(), refreshApprovals()]);
  } catch (e) {
    toast(e.message);
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
      const next = window.prompt(`Temporary generated password: ${data.generatedPassword}\nCopy and set new password:`, data.generatedPassword);
      if (next) {
        await api('/api/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: next })
        });
        toast('Password reset done');
      }
    }

    el('loginCard').classList.add('hidden');
    el('portal').classList.remove('hidden');
    renderTask1Timeline();
    await Promise.all([refreshDashboard(), refreshApprovals()]);
  } catch (e) {
    toast(e.message);
  }
});

el('task1RunBtn').addEventListener('click', async () => {
  try {
    const payload = {
      mgmtServer: el('mgmtServer').value.trim(),
      ldapRegistry: el('ldapRegistry').value.trim(),
      adminUser: el('adminUser').value.trim(),
      adminRealm: el('adminRealm').value.trim(),
      providerOrg: el('providerOrg').value,
      role: el('task1Role').value,
      username: el('task1Username').value.trim()
    };

    const response = await api('/api/task1/cli-simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    renderTask1Timeline(response.logs);
    showModal('Task1 Pre-check Output', `${response.summary}\n\n${response.logs.map((x) => `${x.step}: ${x.message}`).join('\n')}`);
    toast(`Pre-check submitted. Await admin approval #${response.approvalId}`);

    await Promise.all([refreshDashboard(), refreshApprovals()]);
  } catch (e) {
    toast(e.message);
  }
});

loadBootstrap().catch((e) => toast(e.message));
