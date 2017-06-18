#!/bin/bash

rm -rf node_modules
rm -rf npm-debug.log*

npm install --no-optional --production
tar czf --exclude ".git" --exclude "dist.sh" ../pangalink-`jq -r .version package.json`.tar.gz .

echo "done"
