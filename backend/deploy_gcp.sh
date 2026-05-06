#!/bin/bash

# ==========================================
# Google Cloud Run Deployment Script
# ==========================================

echo "☁️  Starting deployment to Google Cloud Run..."

# Copy frontend to public folder so it can be served as a Web App
echo "📦 Copying frontend UI to public folder..."
mkdir -p public
cp "../extension/construction_progress/ui/inspector.html" "public/index.html"
echo "✅ Frontend copied successfully."
echo ""

# Requirements:
# 1. You must have Google Cloud SDK (gcloud) installed
# 2. You must have run 'gcloud auth login'
# 3. Ensure you have switched to PostgreSQL (run ./switch_to_postgres.sh)

PROJECT_ID="your-google-cloud-project-id"
APP_NAME="construction-progress-api"
REGION="asia-southeast1" # Singapore region, change if needed

echo "To deploy this container automatically, run the following command:"
echo "--------------------------------------------------------"
echo "gcloud run deploy $APP_NAME \\"
echo "  --source . \\"
echo "  --project=$PROJECT_ID \\"
echo "  --region=$REGION \\"
echo "  --allow-unauthenticated \\"
echo "  --set-env-vars=\"DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB\""
echo "--------------------------------------------------------"

echo ""
echo "⚠️  Remember to replace:"
echo "- PROJECT_ID with your actual Google Cloud project ID."
echo "- DATABASE_URL with your actual Cloud SQL connection string."
