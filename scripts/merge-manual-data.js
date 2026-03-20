#!/usr/bin/env node
/**
 * Merge Manual Data — merges Manus AI deep-research output into dashboard-state.json
 *
 * Usage:  node scripts/merge-manual-data.js [path/to/manual-update.json]
 *         Defaults to: data/manual-update.json
 *
 * This script:
 *   1. Reads the manual update file (produced by Manus deep research)
 *   2. Appends new kinetic data points (intercept rate, debris) to existing arrays
 *   3. Updates safety score, briefing, infrastructure statuses
 *   4. Recalculates neighborhood local scores based on new debris data
 *   5. Updates the lastUpdated timestamp
 *   6. Writes the merged result back to dashboard-state.json
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'dashboard-state.json');
const DEFAULT_MANUAL = path.join(__dirname, '..', 'data', 'manual-update.json');

const manualFile = process.argv[2] || DEFAULT_MANUAL;

// ── Load Files ──────────────────────────────────────────

let state, manual;

try {
  state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error('❌ Cannot read dashboard-state.json:', e.message);
  process.exit(1);
}

try {
  manual = JSON.parse(fs.readFileSync(manualFile, 'utf8'));
} catch (e) {
  console.error(`❌ Cannot read manual update file (${manualFile}):`, e.message);
  process.exit(1);
}

console.log('═══════════════════════════════════════════════');
console.log('  Merging Manual Research Data');
console.log(`  Source: ${manualFile}`);
console.log(`  Date:   ${manual._date || 'Not specified'}`);
console.log('═══════════════════════════════════════════════\n');

// ── 1. Safety Score ─────────────────────────────────────

if (manual.nationalSafetyScore) {
  const prev = state.nationalSafetyScore.overall;
  state.nationalSafetyScore = manual.nationalSafetyScore;
  // Auto-calculate dayOverDay if not explicitly provided
  if (manual.nationalSafetyScore.dayOverDay === 0 && prev) {
    state.nationalSafetyScore.dayOverDay = manual.nationalSafetyScore.overall - prev;
  }
  console.log(`✅ Safety Score: ${prev} → ${state.nationalSafetyScore.overall} (${state.nationalSafetyScore.dayOverDay >= 0 ? '+' : ''}${state.nationalSafetyScore.dayOverDay})`);
}

// ── 2. Daily Briefing ───────────────────────────────────

if (manual.dailyBriefing) {
  state.dailyBriefing = manual.dailyBriefing;
  console.log(`✅ Daily Briefing updated (${manual.dailyBriefing.length} chars)`);
}

// ── 3. Kinetic Data (append new data points) ────────────

if (manual.kineticData?.national) {
  const kn = manual.kineticData.national;

  // Intercept rate — append to array
  if (kn.interceptRate?.date) {
    const exists = state.kineticData.national.interceptRate.some(d => d.date === kn.interceptRate.date);
    if (!exists) {
      state.kineticData.national.interceptRate.push(kn.interceptRate);
      console.log(`✅ Intercept Rate: added ${kn.interceptRate.date} → ${kn.interceptRate.value}%`);
    } else {
      console.log(`⏭️  Intercept Rate: ${kn.interceptRate.date} already exists, skipping`);
    }
    // Also add to dateLabels if not present
    if (!state.kineticData.dateLabels.includes(kn.interceptRate.date)) {
      state.kineticData.dateLabels.push(kn.interceptRate.date);
    }
  }

  // Debris incidents — append to array
  if (kn.debrisIncidents?.date) {
    const exists = state.kineticData.national.debrisIncidents.some(d => d.date === kn.debrisIncidents.date);
    if (!exists) {
      state.kineticData.national.debrisIncidents.push(kn.debrisIncidents);
      console.log(`✅ Debris Incidents (national): added ${kn.debrisIncidents.date} → ${kn.debrisIncidents.value}`);
    } else {
      console.log(`⏭️  Debris Incidents: ${kn.debrisIncidents.date} already exists, skipping`);
    }
  }
}

// ── 4. Neighborhood Debris (append to per-neighborhood arrays) ──

if (manual.kineticData?.byNeighborhood) {
  const byN = manual.kineticData.byNeighborhood;
  let updated = 0;

  for (const [name, count] of Object.entries(byN)) {
    if (name.startsWith('_')) continue; // skip _note fields
    if (state.kineticData.byNeighborhood[name]) {
      state.kineticData.byNeighborhood[name].debrisIncidents.push(count);

      // Recalculate local score based on recent debris:
      // Base national score minus penalty for recent debris
      const recentDebris = state.kineticData.byNeighborhood[name].debrisIncidents.slice(-5);
      const debrisSum = recentDebris.reduce((a, b) => a + b, 0);
      const nationalScore = state.nationalSafetyScore.overall;
      let localScore = Math.max(0, Math.min(100, nationalScore - (debrisSum * 4)));
      state.kineticData.byNeighborhood[name].localScore = localScore;

      // Update status tier
      if (localScore >= 75) state.kineticData.byNeighborhood[name].status = 'safe';
      else if (localScore >= 50) state.kineticData.byNeighborhood[name].status = 'caution';
      else if (localScore >= 25) state.kineticData.byNeighborhood[name].status = 'warning';
      else state.kineticData.byNeighborhood[name].status = 'critical';

      updated++;
    }
  }
  console.log(`✅ Neighborhood debris: updated ${updated} areas`);
}

// ── 5. Infrastructure Statuses ──────────────────────────

if (manual.infrastructure) {
  for (const [key, val] of Object.entries(manual.infrastructure)) {
    if (state.infrastructure[key]) {
      state.infrastructure[key] = val;
    }
  }
  console.log('✅ Infrastructure statuses updated');
}

// ── 6. Update Timestamp ─────────────────────────────────

state.lastUpdated = new Date().toISOString();
console.log(`\n✅ lastUpdated → ${state.lastUpdated}`);

// ── Write Back ──────────────────────────────────────────

fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
console.log(`\n💾 Written to ${DATA_FILE}`);
console.log('═══════════════════════════════════════════════\n');
