#!/bin/bash

rm -rf node_modules
rm -rf npm-debug.log*
# rm -rf .git
find . -name '.DS_Store' -type f -delete

npm install --no-optional --production --no-bin-links --ignore-scripts
tar czf ../pangalink-`jq -r .version package.json`.tar.gz --exclude '.git' --exclude '.gitignore' --exclude 'dist.sh' .

echo "done"
