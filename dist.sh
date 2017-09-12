#!/bin/bash

rm -rf node_modules
rm -rf npm-debug.log*
# rm -rf .git

npm install --no-optional --production
tar czf ../pangalink-`jq -r .version package.json`.tar.gz --exclude '.git' --exclude '.gitignore' --exclude 'dist.sh' .

echo "done"
