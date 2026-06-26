#!/bin/bash
# Wrapper script for the FRAM fetcher — runs fetcher + macOS notification
set -e

PROJECT=/Users/surindersingh/Documents/volaris
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

LOG=/tmp/fram-fetcher.log
echo "=== $(date) ===" >> "$LOG"
cd "$PROJECT"
"$PROJECT/.venv/bin/python" tools/fetcher.py >> "$LOG" 2>&1

if grep -q "Push OK" "$LOG" 2>/dev/null; then
    COUNT=$(tail -5 "$LOG" | grep -oP 'angel_quotes.*?\d+' | grep -oP '\d+$')
    osascript -e "display notification \"${COUNT:-?} symbols' option data pushed.\" with title \"FRAM Fetcher\" subtitle \"Data pushed to VM\""
else
    osascript -e 'display notification "Check /tmp/fram-fetcher.log" with title "FRAM Fetcher" subtitle "PUSH FAILED"'
fi
