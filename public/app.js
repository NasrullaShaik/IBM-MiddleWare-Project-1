const el = (id) => document.getElementById(id);

const dataFeeds = {
  email: [
    { title: 'Design sprint summary', sub: 'Monica - 5 min ago' },
    { title: 'Cloud invoice approved', sub: 'Finance Ops - 12 min ago' },
    { title: 'Security audit pass', sub: 'SecTeam - 21 min ago' },
    { title: 'Launch checklist ready', sub: 'Program Office - 28 min ago' }
  ],
  jobs: [
    { title: 'Senior AI Product Manager', sub: 'Tesla · Austin' },
    { title: 'ML Platform Architect', sub: 'NVIDIA · Remote' },
    { title: 'Principal Data Strategist', sub: 'Microsoft · Seattle' },
    { title: 'Innovation Program Lead', sub: 'Meta · Menlo Park' }
  ],
  whatsapp: [
    { title: 'Family Group', sub: 'Dinner plan updated' },
    { title: 'Project Apex', sub: 'Prototype review at 6:00 PM' },
    { title: 'Gym Buddy', sub: 'Leg day moved to tomorrow' },
    { title: 'Travel Crew', sub: 'Tickets confirmed ✅' }
  ]
};

function randomRotate(list) {
  const copy = [...list];
  const offset = Math.floor(Math.random() * copy.length);
  return [...copy.slice(offset), ...copy.slice(0, offset)];
}

function renderList(target, items) {
  target.innerHTML = items
    .map((item) => `<li><span class="item-title">${item.title}</span><span class="item-sub">${item.sub}</span></li>`)
    .join('');
}

function stamp(id, label) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el(id).textContent = `${label} ${time}`;
}

function updateEmail() {
  renderList(el('emailList'), randomRotate(dataFeeds.email));
  stamp('emailRefresh', 'Synced');
}

function updateJobs() {
  renderList(el('jobsList'), randomRotate(dataFeeds.jobs));
  stamp('jobsRefresh', 'Updated');
}

function updateWhats() {
  renderList(el('whatsList'), randomRotate(dataFeeds.whatsapp));
  stamp('whatsRefresh', 'Pulse');
}

function updateLifeTracker() {
  const now = new Date();
  const steps = 5000 + Math.floor(Math.random() * 6000);
  const hydration = (1.5 + Math.random() * 1.4).toFixed(1);
  const focus = 65 + Math.floor(Math.random() * 35);
  const sleepDebt = Math.max(0, (7.8 - (5.8 + Math.random() * 2.5))).toFixed(1);

  el('lifeMetrics').innerHTML = `
    <div class="metric"><span>Current Hour</span><strong>${now.getHours().toString().padStart(2, '0')}:00</strong></div>
    <div class="metric"><span>Steps</span><strong>${steps.toLocaleString()}</strong></div>
    <div class="metric"><span>Hydration</span><strong>${hydration} L</strong></div>
    <div class="metric"><span>Focus Index</span><strong>${focus}%</strong></div>
    <div class="metric"><span>Sleep Debt</span><strong>${sleepDebt} h</strong></div>
    <div class="metric"><span>Recovery</span><strong>${sleepDebt < 1.2 ? 'Optimal' : 'Moderate'}</strong></div>
  `;

  stamp('lifeRefresh', 'Hourly scan');
}

function updateClock() {
  const now = new Date();
  el('dateStamp').textContent = now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  el('timeStamp').textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const coreLoad = (96.5 + Math.random() * 3.4).toFixed(1);
  el('coreLoad').textContent = `${coreLoad}%`;
}

function shiftPanels() {
  const panels = Array.from(document.querySelectorAll('.holo-panel'));
  const shouldShift = window.innerWidth > 1100;

  panels.forEach((panel, idx) => {
    panel.style.transform = shouldShift && idx % 2 === 0 ? `translateY(${Math.sin(Date.now() / 900 + idx) * 4}px)` : '';
  });
}

function boot() {
  updateEmail();
  updateJobs();
  updateWhats();
  updateLifeTracker();
  updateClock();

  setInterval(updateEmail, 5000);
  setInterval(updateJobs, 7000);
  setInterval(updateWhats, 6000);
  setInterval(updateLifeTracker, 9000);
  setInterval(updateClock, 1000);
  setInterval(shiftPanels, 1400);

  window.addEventListener('resize', shiftPanels);
}

boot();
