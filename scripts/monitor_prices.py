#!/usr/bin/env python3
import json
import os
import subprocess
import datetime

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'dashboard-state.json')
LOG_FILE = os.path.join(BASE_DIR, 'data', 'compliance-log.txt')
FETCH_SCRIPT = os.path.join(BASE_DIR, 'scripts', 'fetch-data.js')

class ValidationError(Exception):
    pass

def log_compliance(message):
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    log_entry = f"[{timestamp}] COMPLIANCE LOG: {message}\n"
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(log_entry)
    print(log_entry.strip())

def run_fetch_script():
    log_compliance(f"Triggering data fetch script: {FETCH_SCRIPT}")
    # Run fetch-data.js via node
    # Since fetch-data.js requires RAPIDAPI_KEY, we pass environment variables.
    # Note: If no key is set, it might fail, but we'll capture its exit code.
    env = os.environ.copy()
    try:
        result = subprocess.run(['node', FETCH_SCRIPT], env=env, capture_output=True, text=True, check=True)
        log_compliance("Data fetch completed successfully.")
    except subprocess.CalledProcessError as e:
        log_compliance(f"Data fetch script failed: {e.stderr}")
        raise ValidationError(f"Fetch script failed with exit code {e.returncode}: {e.stderr}")

def validate_prices():
    if not os.path.exists(DATA_FILE):
        raise ValidationError(f"Data file not found after fetch: {DATA_FILE}")

    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    log_compliance(f"Data successfully loaded from {DATA_FILE}. Commencing price validation.")

    evacuation = data.get("evacuation", {})
    hotels = evacuation.get("internalRelocation", [])
    flights = evacuation.get("flights", [])

    # 1. Validate Hotels: Check if all hotel prices are exactly the same
    if hotels:
        prices = [h.get("avgPriceAED") for h in hotels if h.get("avgPriceAED", 0) > 0]
        if len(prices) > 1 and len(set(prices)) == 1:
            raise ValidationError(f"Data Privacy / Integrity Error: All {len(prices)} hotel prices are exactly {prices[0]} AED. This suggests an API block or scraping failure.")
    
    # 2. Validate Flights: Check for zero flight prices
    if flights:
        for f in flights:
            if f.get("dxbPriceAED", 0) <= 0 or f.get("auhPriceAED", 0) <= 0:
                dest = f.get("city", "Unknown")
                raise ValidationError(f"Data Integrity Error: Flight to {dest} has a zero or negative price. Data may be incomplete.")

    log_compliance("Validation passed. Data adheres to safety dashboard requirements.")

if __name__ == "__main__":
    # If run directly as a script
    log_compliance("Starting monitor_prices.py routine.")
    try:
        run_fetch_script()
        validate_prices()
        print("Success: Prices monitored and validated without errors.")
    except ValidationError as e:
        log_compliance(f"Validation Error Caught: {e}")
        raise
    except Exception as e:
        log_compliance(f"Unexpected Error: {e}")
        raise
