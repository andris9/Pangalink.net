# Upstart service

Upstart is used by older Ubuntu distros, ie. Ubuntu 14.04.

Unit file assumes that Pangalink code files reside in `/opt/pangalink`

### Setup

1. Copy [pangalink.conf](./pangalink.conf) to `/etc/init/`
2. Start pangalink service with `service pangalink start`
