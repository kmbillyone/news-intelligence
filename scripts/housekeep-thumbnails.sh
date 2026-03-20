#!/bin/bash
# Housekeep news thumbnails (keep for 30 days)
THUMB_DIR="/home/openclaw/.openclaw/workspace/projects/news-intelligence/story-website/public/thumbnails"

if [ -d "$THUMB_DIR" ]; then
    echo "🧹 Housekeeping thumbnails in $THUMB_DIR (older than 30 days)..."
    # Find files older than 30 days and delete them
    find "$THUMB_DIR" -type f -mtime +30 -exec rm -f {} \;
    echo "✅ Done."
else
    echo "⚠️ Thumbnail directory not found: $THUMB_DIR"
fi
