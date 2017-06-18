#!/bin/bash

rm -rf node_modules
rm -rf npm-debug.log*

npm install --no-optional --production
tar czf ../pangalink-`jq -r .version package.json`.tar.gz . --exclude ".git" --exclude "dist.sh"

echo "done"
