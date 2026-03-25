#!/usr/bin/env python3
import sys
import os
import json
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'dashboard-state.json')
DEFAULT_MANUAL = os.path.join(BASE_DIR, 'data', 'manual-update.json')

manual_file = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MANUAL

try:
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        state = json.load(f)
except Exception as e:
    print(f"❌ Cannot read dashboard-state.json: {e}")
    sys.exit(1)

try:
    with open(manual_file, 'r', encoding='utf-8') as f:
        manual = json.load(f)
except Exception as e:
    print(f"❌ Cannot read manual update file ({manual_file}): {e}")
    sys.exit(1)

print('═══════════════════════════════════════════════')
print('  Merging Manual Research Data')
print(f"  Source: {manual_file}")
print(f"  Date:   {manual.get('_date', 'Not specified')}")
print('═══════════════════════════════════════════════\n')

# 1. Safety Score
if "nationalSafetyScore" in manual:
    prev = state.get("nationalSafetyScore", {}).get("overall", 0)
    state["nationalSafetyScore"] = manual["nationalSafetyScore"]
    
    if manual["nationalSafetyScore"].get("dayOverDay") == 0 and prev:
        state["nationalSafetyScore"]["dayOverDay"] = manual["nationalSafetyScore"]["overall"] - prev
        
    overall = state["nationalSafetyScore"]["overall"]
    dod = state["nationalSafetyScore"].get("dayOverDay", 0)
    sign = "+" if dod >= 0 else ""
    print(f"✅ Safety Score: {prev} → {overall} ({sign}{dod})")

# 2. Daily Briefing
if "dailyBriefing" in manual:
    state["dailyBriefing"] = manual["dailyBriefing"]
    print(f"✅ Daily Briefing updated ({len(manual['dailyBriefing'])} chars)")

# 3. Kinetic Data
kinetic_manual = manual.get("kineticData", {})
kinetic_state = state.setdefault("kineticData", {})
kinetic_state_national = kinetic_state.setdefault("national", {})

if "national" in kinetic_manual:
    kn = kinetic_manual["national"]
    
    # Intercept rate
    ir = kn.get("interceptRate")
    if ir and "date" in ir:
        ir_list = kinetic_state_national.setdefault("interceptRate", [])
        exists = any(d.get("date") == ir["date"] for d in ir_list)
        if not exists:
            ir_list.append(ir)
            print(f"✅ Intercept Rate: added {ir['date']} → {ir['value']}%")
        else:
            print(f"⏭️  Intercept Rate: {ir['date']} already exists, skipping")
            
        date_labels = kinetic_state.setdefault("dateLabels", [])
        if ir["date"] not in date_labels:
            date_labels.append(ir["date"])
            
    # Debris
    db = kn.get("debrisIncidents")
    if db and "date" in db:
        db_list = kinetic_state_national.setdefault("debrisIncidents", [])
        exists = any(d.get("date") == db["date"] for d in db_list)
        if not exists:
            db_list.append(db)
            print(f"✅ Debris Incidents (national): added {db['date']} → {db['value']}")
        else:
            print(f"⏭️  Debris Incidents: {db['date']} already exists, skipping")

# 4. Neighborhood Debris
if "byNeighborhood" in kinetic_manual:
    byn = kinetic_manual["byNeighborhood"]
    state_byn = kinetic_state.setdefault("byNeighborhood", {})
    updated = 0
    for name, count in byn.items():
        if name.startswith('_'):
            continue
        if name in state_byn:
            # Append local debris count
            state_byn[name].setdefault("debrisIncidents", []).append(count)
            
            recent_debris = state_byn[name]["debrisIncidents"][-5:]
            debris_sum = sum(recent_debris)
            national_score = state.get("nationalSafetyScore", {}).get("overall", 0)
            
            local_score = max(0, min(100, national_score - (debris_sum * 4)))
            state_byn[name]["localScore"] = local_score
            
            if local_score >= 75:
                status = 'safe'
            elif local_score >= 50:
                status = 'caution'
            elif local_score >= 25:
                status = 'warning'
            else:
                status = 'critical'
                
            state_byn[name]["status"] = status
            updated += 1
            
    print(f"✅ Neighborhood debris: updated {updated} areas")

# 5. Infrastructure
if "infrastructure" in manual:
    state_infra = state.setdefault("infrastructure", {})
    for key, val in manual["infrastructure"].items():
        if key in state_infra:
            state_infra[key] = val
    print('✅ Infrastructure statuses updated')

# 6. Update Timestamp
state["lastUpdated"] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
print(f"\n✅ lastUpdated → {state['lastUpdated']}")

with open(DATA_FILE, 'w', encoding='utf-8') as f:
    json.dump(state, f, indent=2)

print(f"\n💾 Written to {DATA_FILE}")
print('═══════════════════════════════════════════════\n')
