#!/bin/bash
# FRAM fetcher wrapper — runs every 15 min via cron during market hours 9:30-15:30 IST
set -e

PROJECT=/Users/surindersingh/Documents/volaris
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
LOG=/tmp/fram-fetcher.log

# --- Market hours check (IST) ---
HOUR=$(date +%H)
MIN=$(date +%M)
DOW=$(date +%u)  # 1=Mon .. 7=Sun

if [ "$DOW" -ge 6 ]; then
    exit 0  # weekend, skip silently
fi

if [ "$HOUR" -lt 9 ] || [ "$HOUR" -gt 15 ]; then
    exit 0  # outside 9:30-15:30
fi
if [ "$HOUR" -eq 9 ] && [ "$MIN" -lt 30 ]; then
    exit 0  # before 9:30
fi
if [ "$HOUR" -eq 15 ] && [ "$MIN" -gt 30 ]; then
    exit 0  # after 15:30
fi

# --- Run fetcher ---
echo "=== $(date) ===" >> "$LOG"
cd "$PROJECT"
"$PROJECT/.venv/bin/python" tools/fetcher.py >> "$LOG" 2>&1

# --- Check result ---
if grep -q "Push OK" "$LOG" 2>/dev/null; then
    COUNT=$(tail -5 "$LOG" | grep -oP 'angel_quotes.*?\d+' | grep -oP '\d+$')
    osascript -e "display notification \"${COUNT:-?} symbols' option data pushed.\" with title \"FRAM Fetcher\" subtitle \"Data pushed to VM\"" 2>/dev/null || true
    echo "SUCCESS at $(date)" >> "$LOG"
else
    echo "FAILED at $(date)" >> "$LOG"
    tail -5 "$LOG" >> "$LOG"
    osascript -e 'display notification "Check /tmp/fram-fetcher.log" with title "FRAM Fetcher" subtitle "PUSH FAILED"' 2>/dev/null || true
fi
