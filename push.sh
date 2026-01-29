#!/bin/bash

echo "=== CHANGE DETECTED at $(date '+%H:%M:%S') ==="

git add index.html script.js summary_dashboard.html summary_script.js

if git diff --cached --quiet; then
    echo "No changes to commit"
else
    git commit -m "Auto-update: $(date '+%Y-%m-%d %H:%M:%S')" --quiet
    if git push --quiet; then
        echo "Pushed to GitHub!"
    else
        echo "Push failed"
    fi
fi