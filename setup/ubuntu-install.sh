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
apt-get install -y curl lsb-release ufw build-essential python software-properties-common dnsutils

CODENAME=`lsb_release -c -s`

PUBLIC_IP=`curl -s https://api.ipify.org`
if [ ! -z "$PUBLIC_IP" ]; then
    HOSTNAME=`dig +short -x $PUBLIC_IP | sed 's/\.$//'`
    HOSTNAME="${HOSTNAME:-$PUBLIC_IP}"
fi
HOSTNAME="${HOSTNAME:-`hostname`}"

# mongo prerequisites
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 0C49F3730359A14518585931BC711F9BA15703C6
echo "deb [ arch=amd64 ] http://repo.mongodb.org/apt/ubuntu $CODENAME/mongodb-org/3.4 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-3.4.list

curl -sL https://deb.nodesource.com/setup_8.x | bash -

apt-get -q -y install mongodb-org nodejs

apt-get clean

# Enable firewall, allow connections to SSH, HTTP
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable

# Fetch Mailtrain files
mkdir -p /opt/pangalink/config
cp -r . /opt/pangalink

# Add new user for the mailtrain daemon to run as
useradd pangalink || true

# Install required node packages
cd /opt/pangalink

if [ ! -f config/production.json ]; then
# Setup installation configuration
cat >> config/production.json <<EOT
{
    "user": "pangalink",
    "group": "pangalink",
    "web": {
        "port": 80
    },
    "mail": {
        "smtp": {
            "sendmail": false,
            "host": "localhost",
            "port": 25
        }
    }
}
EOT
fi

npm install --no-progress --production
chown -R pangalink:pangalink .
chmod o-rwx config

NODE=`which node`

# Set up systemd service script
sed "s~node index.js~$NODE index.js~" setup/service-scripts/systemd/pangalink.service > /etc/systemd/system/pangalink.service
systemctl enable pangalink.service

# Fetch ZoneMTA files
mkdir -p /opt/zone-mta
cd /opt/zone-mta
git clone git://github.com/zone-eu/zone-mta.git .
git checkout v1.0.0-beta.60

if [ ! -f config/production.json ]; then
# Setup installation configuration
cat >> config/production.json <<EOT
{
    "name": "Pangalink MTA",
    "user": "pangalink",
    "group": "pangalink",
    "queue": {
        "mongodb": "mongodb://127.0.0.1:27017/zone-mta",
        "gfs": "mail",
        "collection": "zone-queue",
        "disableGC": true
    },
    "smtpInterfaces": {
        "feeder": {
            "port": 25,
            "processes": 1,
            "authentication": false,
            "host": "127.0.0.1"
        },
        "bounces": {
            "disabled": true
        }
    },
    "api": {
        "maildrop": false
    },
    "log": {
        "level": "error",
        "syslog": false
    },
    "plugins": {
        "core/email-bounce": false,
        "core/http-bounce": false,
        "core/default-headers": {
            "enabled": ["receiver", "main", "sender"],
            "futureDate": false,
            "xOriginatingIP": false
        },
        "core/rcpt-mx": false
    },
    "pools": {
        "default": [{
            "address": "0.0.0.0",
            "name": "$HOSTNAME"
        }]
    },
    "zones": {
        "default": {
            "processes": 1,
            "connections": 5,
            "throttling": false,
            "pool": "default"
        }
    }
}
EOT
fi

# Install required node packages
npm install --no-progress --no-optional --production

# Set up systemd service script
cp setup/zone-mta.service /etc/systemd/system/
sed "s~ExecStart=.*~ExecStart=$NODE app.js~" setup/zone-mta.service > /etc/systemd/system/zone-mta.service
systemctl enable zone-mta.service

# Start the services
service pangalink start
service zone-mta start

echo "Success! Open http://$HOSTNAME/ and create an admin account";
