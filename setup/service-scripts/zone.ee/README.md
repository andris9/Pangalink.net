# Zone.ee Node.js application

Zone.ee uses PM2 to manage Node.js daemon applications.

Config file assumes that Pangalink code files reside in `~/pangalink` (where ~ is path to home directory)

### Setup

1. Copy [pangalink.json](./pangalink.json) to home directory (the directory that is opened by default after logging in with ssh)
2. Create a new Node.js app from the Zone.ee webhosting dashboard. Use "pangalink.json" as the path to application file. Make sure that the proxy port value matches `web.port` value in Pangalink config (defaults to 3480)
