# SystemD service

SystemD is used by most newer Linux distros, including Ubuntu 16.04+.

Service file assumes that Pangalink code files reside in `/opt/pangalink`

### Setup

1. Copy [pangalink.service](./pangalink.service) to `/etc/systemd/system/`
2. Enable pangalink service with `systemctl enable pangalink.service`
3. Start pangalink service with `systemctl start pangalink`
