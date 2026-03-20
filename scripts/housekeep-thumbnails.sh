#!/bin/bash
# Housekeep news thumbnails (keep for 30 days)
THUMB_DIR="/home/openclaw/.openclaw/workspace/projects/news-intelligence/story-website/public/thumbnails"
AWS_IP="18.207.108.44"
AWS_KEY="/home/openclaw/aws/LightsailDefaultKey-us-east-1.pem"
AWS_THUMB_DIR_PROD="/var/www/news-feed/story/thumbnails"
AWS_THUMB_DIR_UAT="/var/www/news-feed/story-uat/thumbnails"

if [ -d "$THUMB_DIR" ]; then
    echo "🧹 Housekeeping local thumbnails in $THUMB_DIR (older than 30 days)..."
    # Find files older than 30 days and delete them
    find "$THUMB_DIR" -type f -mtime +30 -exec rm -f {} \;
    echo "✅ Local cleanup done."
else
    echo "⚠️ Local thumbnail directory not found: $THUMB_DIR"
fi

echo "🧹 Housekeeping remote thumbnails on AWS Lightsail..."
ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no ubuntu@"$AWS_IP" << EOF
    if [ -d "$AWS_THUMB_DIR_PROD" ]; then
        find "$AWS_THUMB_DIR_PROD" -type f -mtime +30 -exec rm -f {} \\;
        echo "✅ Remote PROD cleanup done."
    fi
    if [ -d "$AWS_THUMB_DIR_UAT" ]; then
        find "$AWS_THUMB_DIR_UAT" -type f -mtime +30 -exec rm -f {} \\;
        echo "✅ Remote UAT cleanup done."
    fi
EOF
echo "🎉 All housekeeping completed."
