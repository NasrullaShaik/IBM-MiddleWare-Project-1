const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'portal-data.json');

const defaultState = {
  users: [
    { user_id: 'apic_admin', role: 'ADMIN', password: 'Temp#1234', must_reset: 1, is_selected: 1 },
    { user_id: 'publisher1', role: 'PUBLISHER', password: 'Temp#1234', must_reset: 1, is_selected: 1 },
    { user_id: 'viewer1', role: 'VIEWER', password: 'Temp#1234', must_reset: 1, is_selected: 0 }
  ],
  sessions: [],
  approvals: [],
  api_registry: [],
  subscriptions: [],
  certs: [],
  counters: { approvals: 0, api_registry: 0, subscriptions: 0, certs: 0 }
};

const loadState = () => {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultState, null, 2));
    return JSON.parse(JSON.stringify(defaultState));
  }

  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    return { ...defaultState, ...data };
  } catch {
    return JSON.parse(JSON.stringify(defaultState));
  }
};

const state = loadState();
const save = () => fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));

const db = {
  listUsers() {
    return state.users.map(({ user_id, role, is_selected }) => ({ user_id, role, is_selected }));
  },

  getUser(userId) {
    return state.users.find((u) => u.user_id === userId) || null;
  },

  updateUserPassword(userId, password) {
    const user = this.getUser(userId);
    if (!user) return null;
    user.password = password;
    user.must_reset = 0;
    save();
    return user;
  },

  createSession(userId, token) {
    state.sessions.push({ token, user_id: userId, created_at: new Date().toISOString() });
    save();
  },

  getSessionUser(token) {
    const session = state.sessions.find((s) => s.token === token);
    if (!session) return null;
    return this.getUser(session.user_id);
  },

  createApproval(taskType, payload, requestedBy) {
    state.counters.approvals += 1;
    const row = {
      id: state.counters.approvals,
      task_type: taskType,
      payload,
      status: 'PENDING',
      requested_by: requestedBy,
      approved_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    state.approvals.push(row);
    save();
    return row;
  },

  listApprovals() {
    return [...state.approvals].sort((a, b) => b.id - a.id);
  },

  getApprovalById(id) {
    return state.approvals.find((a) => a.id === id) || null;
  },

  decideApproval(id, decision, approvedBy) {
    const approval = this.getApprovalById(id);
    if (!approval) return null;
    approval.status = decision;
    approval.approved_by = approvedBy;
    approval.updated_at = new Date().toISOString();
    save();
    return approval;
  },

  findLatestApi(apiName, org, catalog) {
    return [...state.api_registry]
      .filter((a) => a.api_name === apiName && a.org === org && a.catalog === catalog)
      .sort((a, b) => b.id - a.id)[0] || null;
  },

  addApi(payload, createdBy) {
    state.counters.api_registry += 1;
    state.api_registry.push({ id: state.counters.api_registry, ...payload, created_by: createdBy, created_at: new Date().toISOString() });
    save();
  },

  addSubscription(payload, createdBy) {
    state.counters.subscriptions += 1;
    state.subscriptions.push({
      id: state.counters.subscriptions,
      ...payload,
      status: 'ACTIVE',
      created_by: createdBy,
      created_at: new Date().toISOString()
    });
    save();
  },

  addCert(payload) {
    state.counters.certs += 1;
    state.certs.push({ id: state.counters.certs, ...payload, updated_at: new Date().toISOString() });
    save();
  },

  listCerts() {
    return [...state.certs].sort((a, b) => new Date(a.expires_on) - new Date(b.expires_on));
  },

  getCounts() {
    return {
      apiCount: state.api_registry.length,
      pendingCount: state.approvals.filter((a) => a.status === 'PENDING').length,
      subCount: state.subscriptions.length,
      certCount: state.certs.length
    };
  }
};

module.exports = db;
