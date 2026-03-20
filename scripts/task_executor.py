#!/usr/bin/env python3
"""
Automated Monitoring Skill (Manus Skill Wrapper)
Self-Healing Execution for the Safety Dashboard
"""

import time
import subprocess
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONITOR_SCRIPT = os.path.join(BASE_DIR, 'scripts', 'monitor_prices.py')

MAX_RETRIES = 3
RETRY_DELAY_SEC = 5

def alert_manus(message):
    """
    Mock integration for Manus alerts.
    In a fully integrated environment, this would call Manus API or webhook.
    """
    print("======================================================")
    print("🚨 [MANUS SKILL ALERT] ACTION REQUIRED")
    print("------------------------------------------------------")
    print(f"Details: {message}")
    print("======================================================")

def execute_monitor_script():
    """
    Executes the monitor script and returns a boolean indicating success.
    """
    try:
        print(f"Executing: python3 {MONITOR_SCRIPT}")
        result = subprocess.run(['python3', MONITOR_SCRIPT], capture_output=True, text=True, check=True)
        print("Output:", result.stdout.strip())
        return True
    except subprocess.CalledProcessError as e:
        print("Monitor script execution returned an error.")
        print("Error Output:\n", e.stderr.strip() if e.stderr else e.stdout.strip())
        return False

def self_healing_task():
    """
    Wraps the monitoring execution in a self-healing retry loop.
    """
    print("[Self-Healing Execution] Starting task...")
    
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"\n--- Attempt {attempt} of {MAX_RETRIES} ---")
        success = execute_monitor_script()
        
        if success:
            print(f"[Self-Healing Execution] ✅ Task completed successfully on attempt {attempt}.")
            return
        
        if attempt < MAX_RETRIES:
            print(f"[Self-Healing Execution] ⚠️ Task failed. Retrying in {RETRY_DELAY_SEC} seconds...")
            time.sleep(RETRY_DELAY_SEC)
        else:
            print(f"[Self-Healing Execution] ❌ Task failed after {MAX_RETRIES} attempts.")
            # Trigger alert after exhaustion of retries
            alert_manus("Validation logic failed continuously. Potential data source block or API change.")

if __name__ == "__main__":
    self_healing_task()
