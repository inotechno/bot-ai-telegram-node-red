FROM nodered/node-red:5
USER root
RUN apk add --no-cache ca-certificates curl openssl poppler-utils python3 py3-pip
COPY certs/kaspersky-root-ca.crt /usr/local/share/ca-certificates/kaspersky-root-ca.crt
RUN update-ca-certificates
WORKDIR /usr/src/node-red
COPY package.json /tmp/package/package.json
RUN npm install --omit=dev --prefix /data /tmp/package
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/kaspersky-root-ca.crt
USER node-red
