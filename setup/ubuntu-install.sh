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

HTTP_RESPONSE=$(curl --write-out %{http_code} --silent --output /dev/null 127.0.0.1)

if [ HTTP_RESPONSE -eq "000" ] then
    echo "HTTP server already installed"
    exit 1
fi

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

apt-get -q -y install mongodb-org nodejs ssmtp

sed -i -E "s/hostname=.*/hostname=$HOSTNAME/" /etc/ssmtp/ssmtp.conf

apt-get clean

# Enable firewall, allow connections to SSH, HTTP
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable

# Fetch Mailtrain files
mkdir -p /opt/pangalink
cp -r . /opt/pangalink

# Add new user for the mailtrain daemon to run as
useradd pangalink || true

# Install required node packages
cd /opt/pangalink

# Setup installation configuration
cat >> config/production.json <<EOT
{
    "user": "pangalink",
    "group": "pangalink",
    "web": {
        "port": 80
    }
}
EOT

npm install --no-progress --production
chown -R pangalink:pangalink .
chmod o-rwx config

if [ -d "/run/systemd/system" ]; then
    # Set up systemd service script
    cp setup/service-scripts/systemd/pangalink.service /etc/systemd/system/
    systemctl enable pangalink.service
else
    # Set up upstart service script
    cp setup/service-scripts/upstart/pangalink.conf /etc/init/
fi

# Start the service
service pangalink start

echo "Success! Open http://$HOSTNAME/ and create an admin account";
