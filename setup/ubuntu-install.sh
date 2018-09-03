#!/bin/bash

# This installation script works on Ubuntu 14.04 and 16.04
# Run as root!

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

set -e

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get upgrade -y
apt-get install -y curl build-essential python software-properties-common dnsutils

PUBLIC_IP=`curl -s https://api.ipify.org`
if [ ! -z "$PUBLIC_IP" ]; then
    HOSTNAME=`dig +short -x $PUBLIC_IP | sed 's/\.$//'`
    HOSTNAME="${HOSTNAME:-$PUBLIC_IP}"
fi
HOSTNAME="${HOSTNAME:-`hostname`}"

# mongo prerequisites
MONGODB="3.6"
wget -qO- https://www.mongodb.org/static/pgp/server-${MONGODB}.asc | sudo apt-key add
# hardcode xenial as at this time there are no non-dev packages for bionic (http://repo.mongodb.org/apt/ubuntu/dists/)
echo "deb [ arch=amd64,arm64 ] http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/$MONGODB multiverse" > /etc/apt/sources.list.d/mongodb-org.list

# also calls apt-get update
curl -sL https://deb.nodesource.com/setup_10.x | bash -

apt-get -q -y install mongodb-org nodejs

apt-get clean

# Copy files
mkdir -p /opt/pangalink/config
cp -r . /opt/pangalink

# Add new user for the mailtrain daemon to run as
useradd pangalink || true

# Install required node packages
cd /opt/pangalink

if [ ! -f config/production.json ]; then
# Setup installation configuration
echo "{
    \"user\": \"pangalink\",
    \"group\": \"pangalink\",
    \"web\": {
        \"port\": 80
    },
    \"mail\": {
        \"smtp\": {
            \"direct\": true
        },
        \"defaults: {
            \"from\": \"no-reply@$HOSTNAME\"
        }\"
    }
}" > config/production.json
fi

npm install --no-progress --production
chown -R pangalink:pangalink .
chmod o-rwx config

NODE=`which node`

# Set up systemd service script
sed "s~node index.js~$NODE index.js~" setup/service-scripts/systemd/pangalink.service > /etc/systemd/system/pangalink.service
systemctl enable pangalink.service

# Start the services
service pangalink start

echo "Success! Open http://$HOSTNAME/ and create an admin account";
