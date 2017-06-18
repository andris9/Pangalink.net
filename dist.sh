#!/bin/bash

rm -rf node_modules
rm -rf npm-debug.log*

VERSION=`jq -r .version package.json`

npm install --no-optional --production
rm -rf ../pangalink-$VERSION.tar.gz
tar -zcv --exclude='.git' --exclude='.gitignore' -f ../pangalink-$VERSION.tar.gz .

echo "done"
