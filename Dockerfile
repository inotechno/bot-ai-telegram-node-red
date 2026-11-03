FROM nodered/node-red:5
USER root

# 1) Percayai TLS inspection (Kaspersky) TERLEBIH DAHULU.
#    apk & npm membaca /etc/ssl/cert.pem; tanpa ini, unduh index APKINDEX
#    gagal "TLS: server certificate not trusted" -> paket dilaporkan hilang.
COPY certs/kaspersky-root-ca.crt /usr/local/share/ca-certificates/kaspersky-root-ca.crt
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/kaspersky-root-ca.crt

# 2) Paket sistem (butuh kepercayaan TLS dari langkah 1)
RUN apk add --no-cache ca-certificates curl openssl poppler-utils python3 py3-pip \
    && update-ca-certificates

WORKDIR /usr/src/node-red
COPY package.json /tmp/package/package.json
RUN npm install --omit=dev --prefix /data /tmp/package
USER node-red
