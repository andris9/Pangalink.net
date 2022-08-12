FROM node:lts-alpine

RUN apk add --no-cache dumb-init openssl

WORKDIR /pangalinker
COPY . .

RUN npm install --production

ENV PL_APPDIR=/pangalinker
ENV PL_HOST=0.0.0.0

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
WORKDIR ${PL_APPDIR}
CMD node server.js