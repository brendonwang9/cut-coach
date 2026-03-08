#!/bin/bash
# Run this from the directory where you unzipped cut-coach-sync.zip

cd cut-coach-sync

# Initialize git and push to your new repo
git init
git add .
git commit -m "Initial commit: Cut Coach sync pipeline"
git branch -M main
git remote add origin git@github.com:brendonwang9/cut-coach.git
git push -u origin main

echo "✅ Pushed to github.com/brendonwang9/cut-coach"
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env"
echo "  2. Fill in your credentials in .env"
echo "  3. npm install"
echo "  4. npm run sync:backfill"
