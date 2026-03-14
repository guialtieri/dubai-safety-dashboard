/* ================================================================
   Geopolitical Safety Dashboard — V2 Application Logic
   Neighborhood-driven, smarter trends, clickable heatmap
   ================================================================ */

(function () {
  'use strict';

  const TIERS = [
    { min: 75, max: 100, id: 'safe', label: 'Safe Zone', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢',
      actionTitle: 'All Clear — Normal Vigilance',
      actionText: 'Current indicators do not suggest elevated risk for your area. Continue daily routines and stay informed through official channels.' },
    { min: 50, max: 74, id: 'caution', label: 'Caution Zone', color: '#facc15', bg: 'rgba(250,204,21,0.12)', icon: '🟡',
      actionTitle: 'Elevated Indicators — Stay Informed',
      actionText: 'Some risk indicators are elevated. Ensure essential documents (passport, insurance) are easily accessible. Review your personal evacuation plan. No immediate action required unless your personal risk tolerance dictates otherwise.' },
    { min: 25, max: 49, id: 'warning', label: 'Warning Zone', color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: '🟠',
      actionTitle: 'Multiple Risk Factors Active — Consider Relocating',
      actionText: 'Multiple risk factors are active in your area. Consider relocating to a safer area within the UAE (see options below). Prepare go-bags, secure important documents, and confirm communication plans with family members.' },
    { min: 0, max: 24, id: 'critical', label: 'Critical Zone', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🔴',
      actionTitle: 'Critical — Immediate Departure Recommended',
      actionText: 'Conditions in your area warrant immediate action. Book the next available flight from the options below. Contact your embassy or consulate. Do not delay — availability is changing rapidly.' }
  ];

  const CIRCUMFERENCE = 2 * Math.PI * 52;

  let data = null;
  let interceptChart = null;
  let debrisChart = null;
  let selectedNeighborhood = 'Al Furjan';
  let selectedHeatmapArea = null; // null = national (all areas)

  // ---- Init ----
  async function init() {
    await loadData();
    if (!data) return;
    renderHeader();
    populateNeighborhoodSelector();
    renderAll();
    setupLegendModal();
    setupCronSimulation();
  }

  function renderAll() {
    renderScore();
    renderKinetic();
    renderHeatmap();
    renderProximity();
    renderInfrastructure();
    renderEvacuation();
    renderFooter();
  }

  // ---- Data ----
  async function loadData() {
    try {
      const resp = await fetch('./data/dashboard-state.json');
      data = await resp.json();
    } catch (e) {
      console.error('Failed to load:', e);
      document.getElementById('app').innerHTML =
        '<p style="text-align:center;color:#ef4444;padding:4rem;">Failed to load dashboard data. Please refresh.</p>';
    }
  }

  // ---- Utilities ----
  function getTier(score) {
    return TIERS.find(t => score >= t.min && score <= t.max) || TIERS[3];
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hrs > 24) return `${Math.floor(hrs / 24)} day(s) ago`;
    if (hrs > 0) return `${hrs}h ${mins}m ago`;
    return `${mins}m ago`;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getLocalScore() {
    const nData = data.kineticData.byNeighborhood[selectedNeighborhood];
    return nData ? nData.localScore : data.nationalSafetyScore.overall;
  }

  // ---- Smart Trend Detection ----
  function detectAllTrends() {
    const trends = [];
    const { interceptRate, debrisIncidents } = data.kineticData.national;

    // National intercept rate trend
    const irRecent = interceptRate.slice(-5).map(d => d.value);
    const irPrior = interceptRate.slice(-10, -5).map(d => d.value);
    const irRecentAvg = avg(irRecent);
    const irPriorAvg = avg(irPrior);
    const irChange = irRecentAvg - irPriorAvg;

    if (Math.abs(irChange) < 0.5) {
      trends.push({ text: `Intercept rate holding steady at ~${Math.round(irRecentAvg)}% (stable over 10 days)`, positive: true });
    } else {
      const dir = irChange > 0 ? 'improving' : 'declining';
      trends.push({ text: `Intercept rate ${dir} (${irChange > 0 ? '+' : ''}${irChange.toFixed(1)}% 5-day avg shift)`, positive: irChange > 0 });
    }

    // National debris trend
    const dbRecent = debrisIncidents.slice(-5).map(d => d.value);
    const dbPrior = debrisIncidents.slice(-10, -5).map(d => d.value);
    const dbRecentAvg = avg(dbRecent);
    const dbPriorAvg = avg(dbPrior);
    const dbChange = dbRecentAvg - dbPriorAvg;

    if (Math.abs(dbChange) > 0.3) {
      const dir = dbChange > 0 ? 'increasing' : 'decreasing';
      const severity = Math.abs(dbChange) > 1 ? 'notably' : 'slightly';
      trends.push({
        text: `Daily debris incidents ${severity} ${dir} (avg ${dbPriorAvg.toFixed(1)} → ${dbRecentAvg.toFixed(1)})`,
        positive: dbChange < 0
      });
    }

    // Day-over-day debris spike
    const lastDb = debrisIncidents[debrisIncidents.length - 1].value;
    const prevDb = debrisIncidents[debrisIncidents.length - 2]?.value;
    if (prevDb !== undefined && lastDb - prevDb >= 2) {
      trends.push({ text: `Debris spike today: ${lastDb} incidents (was ${prevDb} yesterday)`, positive: false });
    }

    // Per-neighborhood trends for selected area
    const nData = data.kineticData.byNeighborhood[selectedNeighborhood];
    if (nData) {
      const nRecent = nData.debrisIncidents.slice(-5);
      const nPrior = nData.debrisIncidents.slice(-10, -5);
      const nRecentTotal = nRecent.reduce((a, b) => a + b, 0);
      const nPriorTotal = nPrior.reduce((a, b) => a + b, 0);

      if (nRecentTotal > nPriorTotal && nRecentTotal > 0) {
        trends.push({
          text: `${selectedNeighborhood}: ${nRecentTotal} incidents last 5 days vs ${nPriorTotal} prior — local risk increasing`,
          positive: false
        });
      } else if (nRecentTotal === 0 && nPriorTotal === 0) {
        trends.push({
          text: `${selectedNeighborhood}: Zero debris incidents recorded throughout the conflict`,
          positive: true
        });
      } else if (nRecentTotal <= nPriorTotal && nRecentTotal >= 0) {
        trends.push({
          text: `${selectedNeighborhood}: ${nRecentTotal} incidents last 5 days (stable or improving)`,
          positive: true
        });
      }
    }

    // Check if any neighborhood is getting worse
    const worseningAreas = [];
    for (const [area, areaData] of Object.entries(data.kineticData.byNeighborhood)) {
      if (area === selectedNeighborhood) continue;
      const r5 = areaData.debrisIncidents.slice(-5).reduce((a, b) => a + b, 0);
      const p5 = areaData.debrisIncidents.slice(-10, -5).reduce((a, b) => a + b, 0);
      if (r5 > p5 + 2) worseningAreas.push(area);
    }
    if (worseningAreas.length > 0) {
      trends.push({
        text: `Worsening areas: ${worseningAreas.join(', ')}`,
        positive: false
      });
    }

    return trends;
  }

  function avg(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  // ---- Header ----
  function renderHeader() {
    const el = document.getElementById('lastUpdatedText');
    el.textContent = `${formatDate(data.lastUpdated)}, ${formatTime(data.lastUpdated)} GST · ${timeAgo(data.lastUpdated)}`;
  }

  // ---- Neighborhood Selector ----
  function populateNeighborhoodSelector() {
    const select = document.getElementById('neighborhoodSelect');
    const areas = Object.keys(data.neighborhoods).sort();

    select.innerHTML = areas.map(n =>
      `<option value="${n}" ${n === selectedNeighborhood ? 'selected' : ''}>${n}</option>`
    ).join('');

    select.addEventListener('change', () => {
      selectedNeighborhood = select.value;
      selectedHeatmapArea = null; // reset heatmap filter
      renderAll();
    });
  }

  // ---- Score (Row 1) ----
  function renderScore() {
    const localScore = getLocalScore();
    const { dayOverDay } = data.nationalSafetyScore;
    const tier = getTier(localScore);

    // Animate score
    animateCounter('scoreNumber', 0, localScore, 1200);

    // Arc
    const offset = CIRCUMFERENCE - (localScore / 100) * CIRCUMFERENCE;
    const fill = document.getElementById('scoreFill');
    fill.style.strokeDasharray = CIRCUMFERENCE;
    fill.style.strokeDashoffset = CIRCUMFERENCE;
    fill.style.stroke = tier.color;
    requestAnimationFrame(() => { fill.style.strokeDashoffset = offset; });

    // Trend
    const trendEl = document.getElementById('scoreTrend');
    const isUp = dayOverDay >= 0;
    trendEl.className = `score-trend ${isUp ? 'up' : 'down'}`;
    document.getElementById('trendArrow').textContent = isUp ? '↗' : '↘';
    document.getElementById('trendValue').textContent = `${isUp ? '+' : ''}${dayOverDay} vs yesterday`;

    // Tier badge
    const tierEl = document.getElementById('scoreTier');
    tierEl.textContent = tier.label;
    tierEl.style.color = tier.color;
    tierEl.style.background = tier.bg;

    // Highlight active tier in inline legend
    document.querySelectorAll('.tier-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tier === tier.id);
    });

    // Timestamp
    document.getElementById('scoreTimestamp').textContent =
      `Updated: ${formatDate(data.lastUpdated)}, ${formatTime(data.lastUpdated)} GST · Score for ${selectedNeighborhood}`;

    // Recommendation box
    const recBox = document.getElementById('recommendationBox');
    recBox.style.background = tier.bg;
    recBox.style.border = `1px solid ${tier.color}33`;
    document.getElementById('recIcon').textContent = tier.icon;
    document.getElementById('recTitle').textContent = tier.actionTitle;
    document.getElementById('recTitle').style.color = tier.color;
    document.getElementById('recText').textContent = tier.actionText;

    // Briefing
    document.getElementById('briefingText').textContent = data.dailyBriefing;

    // Trend tags
    const allTrends = detectAllTrends();
    const tagsContainer = document.getElementById('trendTags');
    tagsContainer.innerHTML = allTrends.map(t => {
      const color = t.positive ? 'var(--color-safe)' : 'var(--color-warning)';
      const bg = t.positive ? 'var(--color-safe-bg)' : 'var(--color-warning-bg)';
      return `<span class="trend-tag" style="background:${bg};color:${color}">${t.positive ? '✓' : '⚠'} ${t.text}</span>`;
    }).join('');
  }

  function animateCounter(id, start, end, dur) {
    const el = document.getElementById(id);
    const t0 = performance.now();
    (function tick(now) {
      const p = Math.min((now - t0) / dur, 1);
      el.textContent = Math.round(start + (end - start) * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  // ---- Kinetic Charts (Row 2) ----
  function renderKinetic() {
    const { interceptRate, debrisIncidents } = data.kineticData.national;
    const dateLabels = data.kineticData.dateLabels.map(d => {
      const dt = new Date(d);
      return `${dt.getDate()}/${dt.getMonth() + 1}`;
    });

    // Current values
    document.getElementById('interceptValue').textContent = `${interceptRate[interceptRate.length - 1].value}%`;

    // Debris data — show neighborhood if one is selected via heatmap
    let debrisData, debrisTitle;
    if (selectedHeatmapArea && data.kineticData.byNeighborhood[selectedHeatmapArea]) {
      debrisData = data.kineticData.byNeighborhood[selectedHeatmapArea].debrisIncidents;
      debrisTitle = `Debris Incidents — ${selectedHeatmapArea}`;
    } else {
      debrisData = debrisIncidents.map(d => d.value);
      debrisTitle = 'Debris Incidents — All Areas (National)';
    }

    document.getElementById('debrisChartTitle').textContent = debrisTitle;
    document.getElementById('debrisValue').textContent = debrisData[debrisData.length - 1];

    // Chart defaults
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';
    Chart.defaults.font.family = 'Inter';
    Chart.defaults.font.size = 11;

    // Destroy old
    if (interceptChart) { interceptChart.destroy(); interceptChart = null; }
    if (debrisChart) { debrisChart.destroy(); debrisChart = null; }

    // Intercept chart
    const ctxI = document.getElementById('interceptChart').getContext('2d');
    interceptChart = new Chart(ctxI, {
      type: 'line',
      data: {
        labels: dateLabels,
        datasets: [{
          data: interceptRate.map(d => d.value),
          borderColor: '#00ffc8',
          backgroundColor: gradient(ctxI, '#00ffc8'),
          borderWidth: 2, fill: true, tension: 0.4,
          pointRadius: 3, pointBackgroundColor: '#00ffc8',
          pointBorderColor: '#0c1220', pointBorderWidth: 2, pointHoverRadius: 6
        }]
      },
      options: chartOpts(90, 100)
    });

    // Debris chart
    const ctxD = document.getElementById('debrisChart').getContext('2d');
    debrisChart = new Chart(ctxD, {
      type: 'bar',
      data: {
        labels: dateLabels,
        datasets: [{
          data: debrisData,
          backgroundColor: debrisData.map(v =>
            v >= 4 ? 'rgba(239,68,68,0.7)' :
            v >= 2 ? 'rgba(249,115,22,0.7)' :
            v >= 1 ? 'rgba(250,204,21,0.7)' :
            'rgba(34,197,94,0.3)'
          ),
          borderRadius: 4, borderSkipped: false, barPercentage: 0.6
        }]
      },
      options: chartOpts(0)
    });
  }

  function gradient(ctx, color) {
    const g = ctx.createLinearGradient(0, 0, 0, 130);
    g.addColorStop(0, color + '30');
    g.addColorStop(1, color + '00');
    return g;
  }

  function chartOpts(min, max) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0c1220', borderColor: 'rgba(0,255,200,0.15)',
          borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: false
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(255,255,255,0.03)' }, suggestedMin: min, suggestedMax: max }
      },
      interaction: { intersect: false, mode: 'index' }
    };
  }

  // ---- Heatmap (clickable) ----
  function renderHeatmap() {
    const grid = document.getElementById('heatmapGrid');
    const byN = data.kineticData.byNeighborhood;

    grid.innerHTML = Object.entries(byN).map(([name, info]) => {
      const isActive = selectedHeatmapArea === name;
      return `<div class="heatmap-cell ${info.status} ${isActive ? 'active' : ''}" data-area="${name}">${name}</div>`;
    }).join('');

    // Click handlers
    grid.querySelectorAll('.heatmap-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const area = cell.dataset.area;
        // Toggle: click same area = go back to national
        if (selectedHeatmapArea === area) {
          selectedHeatmapArea = null;
        } else {
          selectedHeatmapArea = area;
        }
        renderKinetic();
        renderHeatmap(); // re-render to update active state
      });
    });
  }

  // ---- Proximity (Row 3) ----
  function renderProximity() {
    const nCoords = data.neighborhoods[selectedNeighborhood];
    if (!nCoords) return;

    document.getElementById('proximityNeighborhood').textContent = selectedNeighborhood;

    const list = document.getElementById('proximityList');
    list.innerHTML = data.strategicTargets.map(target => {
      const dist = haversineKm(nCoords.lat, nCoords.lng, target.lat, target.lng);
      const km = dist.toFixed(1);
      let cls = 'far', emoji = '🟢';
      if (dist < 15) { cls = 'close'; emoji = '🔴'; }
      else if (dist < 30) { cls = 'medium'; emoji = '🟡'; }

      return `
        <div class="proximity-item">
          <div>
            <span class="proximity-name">${emoji} ${target.name}</span>
            <span class="proximity-type">${target.type}</span>
          </div>
          <span class="proximity-distance ${cls}">${km} km</span>
        </div>`;
    }).join('');
  }

  // ---- Infrastructure (Row 4) ----
  function renderInfrastructure() {
    const config = [
      { key: 'schoolClosures', title: 'School / Gov Closures', icon: '🏫' },
      { key: 'supermarketStock', title: 'Supermarket Stock', icon: '🛒' },
      { key: 'fuelAvailability', title: 'Fuel Availability', icon: '⛽' }
    ];

    const statusMap = { normal: 'safe', safe: 'safe', caution: 'caution', warning: 'warning', critical: 'critical' };

    document.getElementById('infraRow').innerHTML = config.map(({ key, title, icon }) => {
      const d = data.infrastructure[key];
      const dot = statusMap[d.status] || 'safe';
      return `
        <div class="card card-sm">
          <div class="traffic-light">
            <div class="traffic-dot ${dot}"></div>
            <div class="traffic-info">
              <h4>${icon} ${title}</h4>
              <p class="traffic-status">${d.label}</p>
              <p class="traffic-guidance">${d.guidance}</p>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ---- Evacuation (Row 5) ----
  function renderEvacuation() {
    const nCoords = data.neighborhoods[selectedNeighborhood];

    // Internal relocation — compute distances dynamically, sort by nearest
    const relocations = data.evacuation.internalRelocation.map(item => {
      const dist = nCoords ? haversineKm(nCoords.lat, nCoords.lng, item.lat, item.lng) : 0;
      return { ...item, distKm: dist };
    }).sort((a, b) => a.distKm - b.distKm);

    const intTbody = document.querySelector('#internalTable tbody');
    intTbody.innerHTML = relocations.map(item => {
      const barColor = item.availabilityPct > 60 ? 'var(--color-safe)' :
                       item.availabilityPct > 30 ? 'var(--color-caution)' : 'var(--color-critical)';

      // Availability delta vs yesterday — explicit label
      const availDelta = item.availabilityPct - item.availabilityYesterday;
      let availDeltaHtml = '';
      if (availDelta !== 0) {
        const sign = availDelta > 0 ? '+' : '';
        const color = availDelta < 0 ? 'var(--color-down)' : 'var(--color-up)';
        const arrow = availDelta < 0 ? '▼' : '▲';
        availDeltaHtml = `<span style="color:${color};margin-left:4px;font-size:0.68rem">${arrow} ${sign}${availDelta}% vs yesterday</span>`;
      } else {
        availDeltaHtml = `<span style="color:var(--text-dim);margin-left:4px;font-size:0.68rem">— unchanged</span>`;
      }

      return `
        <tr>
          <td><span class="city-name">${item.destination}</span></td>
          <td><span style="font-size:0.72rem;color:var(--text-dim)">${item.emirate}</span></td>
          <td><span style="font-size:0.78rem;font-weight:600">${item.distKm.toFixed(0)} km</span></td>
          <td>
            <span style="font-weight:600">${item.availabilityPct}%</span>
            ${availDeltaHtml}
            <div class="avail-bar"><div class="avail-bar-fill" style="width:${item.availabilityPct}%;background:${barColor}"></div></div>
          </td>
          <td><span class="price">AED ${item.avgPriceAED.toLocaleString()}</span><span style="font-size:0.68rem;color:var(--text-dim)">/night</span></td>
        </tr>`;
    }).join('');

    // Flights — sorted by DXB departure time, prices in AED
    const sortedFlights = [...data.evacuation.flights].sort((a, b) =>
      new Date(a.dxbDepart) - new Date(b.dxbDepart)
    );

    const flTbody = document.querySelector('#flightsTable tbody');
    flTbody.innerHTML = sortedFlights.map(f => {
      const dxbDeltaCls = f.dxbDeltaAED > 0 ? 'up' : 'down';
      const auhDeltaCls = f.auhDeltaAED > 0 ? 'up' : 'down';
      const dxbSym = f.dxbDeltaAED > 0 ? '▲' : '▼';
      const auhSym = f.auhDeltaAED > 0 ? '▲' : '▼';

      const dxbDt = new Date(f.dxbDepart);
      const auhDt = new Date(f.auhDepart);
      const dxbTimeStr = dxbDt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dxbDateStr = dxbDt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

      return `
        <tr>
          <td>
            <span class="city-name">${f.city}</span> <span class="city-code">(${f.code})</span>
            <span class="city-country">${f.country} · <strong style="color:var(--text-secondary)">${f.airline}</strong></span>
          </td>
          <td>
            <span class="depart-time">DXB ${dxbTimeStr}</span>
            <span class="depart-date">${dxbDateStr}</span>
          </td>
          <td>
            <span class="price">AED ${f.dxbPriceAED.toLocaleString()}</span>
            <span class="price-delta ${dxbDeltaCls}">${dxbSym} AED ${Math.abs(f.dxbDeltaAED)} vs yesterday</span>
          </td>
          <td>
            <span class="price">AED ${f.auhPriceAED.toLocaleString()}</span>
            <span class="price-delta ${auhDeltaCls}">${auhSym} AED ${Math.abs(f.auhDeltaAED)} vs yesterday</span>
          </td>
        </tr>`;
    }).join('');
  }

  // ---- Footer ----
  function renderFooter() {
    document.getElementById('sourcesGrid').innerHTML = data.dataSources.map(s =>
      `<a class="source-item" href="${s.url}" target="_blank" rel="noopener">
        <span class="source-category">${s.category}</span>
        <span class="source-name">${s.name} ↗</span>
      </a>`
    ).join('');
  }

  // ---- Legend Modal ----
  function setupLegendModal() {
    const modal = document.getElementById('legendModal');
    const btnOpen = document.getElementById('btnLegend');
    const btnClose = document.getElementById('modalClose');

    btnOpen.addEventListener('click', () => modal.classList.add('active'));
    btnClose.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('active'); });
  }

  // ---- Cron ----
  function setupCronSimulation() {
    setInterval(() => {
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const gst = new Date(utcMs + 4 * 60 * 60000);
      if (gst.getHours() === 8 && gst.getMinutes() === 0) {
        console.log('[CRON] 08:00 GST — refreshing…');
        refreshDashboard();
      }
    }, 60000);
    console.log('[CRON] Active — refreshes at 08:00 GST');
  }

  async function refreshDashboard() {
    await loadData();
    if (!data) return;
    renderHeader();
    renderAll();
  }

  // ---- Boot ----
  document.addEventListener('DOMContentLoaded', init);
})();
