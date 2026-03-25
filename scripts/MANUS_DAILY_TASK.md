# Manus Daily Research Task — Dubai Safety Dashboard

## Schedule
Run this task daily at **06:30 GST** (so it completes before the 07:00 GST API refresh).

## Objective
Conduct deep research on the current UAE/Dubai security situation related to the Iran-Israel conflict and output a structured JSON file that updates the dashboard's manually-curated data **at both national and neighborhood level**.

## Research Sources (check all of these)

### National-Level Sources
1. **UAE National Defense** — Official briefings, NCEMA (ncema.gov.ae)
2. **News agencies** — WAM (wam.ae), Reuters, Al Jazeera, Gulf News, The National UAE
3. **Military/conflict** — SIPRI, open-source intercept reports, social media OSINT
4. **Diplomatic** — MoFA UAE statements, UN Security Council updates, ceasefire negotiations

### Neighborhood/Area-Level Sources
5. **Social media OSINT** — Search Twitter/X, Reddit, Telegram channels for neighborhood-specific reports: explosion sounds, debris sightings, sirens, closures. Search by area name + keywords like "debris", "explosion", "intercepted", "closed"
6. **Local news** — Gulf News, Khaleej Times, Dubai Media Office for area-specific incident reports
7. **Proximity analysis** — Cross-reference intercepted projectile reports with known strategic targets to estimate which neighborhoods are most exposed:
   - **High risk areas** (near military/port targets): Jebel Ali, Marina, JBR, Al Furjan, Palm Jumeirah
   - **Medium risk areas** (near corporate/airport targets): Al Barsha, Al Quoz, Dubai Hills, JVC
   - **Lower risk areas** (residential, far from targets): Silicon Oasis, Mirdif, International City, Arabian Ranches, Deira, Bur Dubai, Jumeirah Islands
   - **East coast areas** (far from Gulf-facing targets): Fujairah, Al Aqqah, Khor Fakkan, Dibba
8. **Infrastructure** — KHDA/MOE (school closures by area), ADNOC/ENOC (fuel by station area), Carrefour/Lulu/Spinneys (stock by branch location)

## What to Research & Output

### 1. National Safety Score (0–100)
Assess overall safety based on:
- **Kinetic (35%)**: Intercept rate performance, projectile count, debris reports
- **Infrastructure (25%)**: Schools open? Fuel available? Supermarkets stocked?
- **Diplomatic (20%)**: Ceasefire progress? Escalation signals? Embassy advisories?
- **Economic (10%)**: Flight price spikes? Currency stability?
- **Social (10%)**: Public closures? Event cancellations?

### 2. Daily Briefing
Write a 2–3 sentence factual summary of overnight developments.

### 3. Intercept Rate
What was today's reported intercept rate? (Typically 95–99%)

### 4. Debris Incidents — CRITICAL: Per-Neighborhood
This is the most important area-level data. For **each** of the 22 neighborhoods below, determine today's debris incident count:

| Neighborhood | Risk Profile | What to Look For |
|---|---|---|
| Downtown | Central, moderate | Social media reports, Burj Khalifa area |
| Marina | Coastal, near port corridor | Debris from Gulf-facing intercepts |
| Jebel Ali | HIGH — adjacent to port/naval facility | Direct target proximity reports |
| DIFC | Central financial district | Business disruption reports |
| JBR | Coastal, near Marina | Beach-area debris sightings |
| Al Barsha | Central, near DIC | Corporate area incident reports |
| Silicon Oasis | Eastern, residential | Usually quiet — verify |
| Palm Jumeirah | Coastal, exposed | Waterfront debris reports |
| Al Furjan | Western, near Jebel Ali corridor | Secondary debris from port-area intercepts |
| JVC | Central-west | Residential area reports |
| Business Bay | Central | Canal-area reports |
| Deira | Northern, old Dubai | Creek-area reports |
| Bur Dubai | Northern, old Dubai | Usually quiet — verify |
| Al Quoz | Industrial, central | Workshop/industrial area reports |
| International City | Far east | Usually quiet — verify |
| Mirdif | Far east, residential | Usually quiet — verify |
| Dubai Hills | Central-south | Residential community reports |
| Jumeirah | Coastal, central | Beach road area reports |
| Arabian Ranches | Southern, suburban | Usually quiet — verify |
| Jumeirah Islands | Western, residential | Lake community reports |
| Fujairah | East coast city | Far from Gulf targets — usually safe |
| Al Aqqah | East coast beach town | Far from Gulf targets — usually safe |

**Method**: For areas with no specific reports, use `0`. Only assign non-zero values when there is a credible report (news article, verified social media post, or official statement) of debris landing or intercept-related incidents in or very near that area.

### 5. Infrastructure Status
For each: set status to `normal`/`safe`/`caution`/`warning`/`critical` with a short label and guidance sentence.
- School/Government closures (check KHDA announcements)
- Supermarket stock levels (check social media for empty shelves reports)
- Fuel availability (check ENOC/ADNOC station reports)

## Output Format
Save the completed JSON to: `data/manual-update.json`

Use this exact structure (copy from `data/manual-update-template.json` and fill in today's values).

## After Saving
Run this command to merge the data into the dashboard:
```bash
python3 scripts/merge-manual-data.py
```

This will append the new data points, recalculate neighborhood scores, and update the timestamp in your local workspace.

**CRITICAL DEPLOYMENT STEP:**
Because the dashboard is hosted live on GitHub Pages, you **MUST** commit and push these changes to GitHub after merging to update the live site. Run the following command:
```bash
git add data/dashboard-state.json data/manual-update.json
git commit -m "chore: daily manual data update"
git push origin main
```
