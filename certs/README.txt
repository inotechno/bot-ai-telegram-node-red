Copy your Kaspersky root CA PEM certificate here as certs/kaspersky-root-ca.crt before docker compose build. Do not commit private keys.

Notes:
- kaspersky-root-ca.crt may contain MULTIPLE CA certs concatenated (PEM bundle).
  It is referenced by ENV NODE_EXTRA_CA_CERTS (used by Node.js/npm).
- kaspersky-chain-ca.crt is the CA actually used by the TLS interception chain
  for some domains (same subject, different certificate). update-ca-certificates
  picks up every *.crt in this folder for the system bundle (/etc/ssl/certs).
