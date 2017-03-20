FROM node:6
MAINTAINER Tõnis Tobre <tobre@bitweb.ee>

ENV NODE_ENV=production node index.js

EXPORT 80

CMD ["node" "index.js"]
