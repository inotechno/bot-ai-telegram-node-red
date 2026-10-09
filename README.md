# AI Integrator V3.2 — Multi-Provider

Telegram + Node-RED + PostgreSQL + automatic memory + AI Router.

## Provider fallback
Default order: Groq -> Gemini -> OpenRouter. Configure `AI_PROVIDER_ORDER` to change it. The flow sends the same OpenAI-compatible chat request to the first configured provider and retries the next provider when the response is unsuccessful.

## Setup
1. Copy `.env.example` to `.env`.
2. Fill `TELEGRAM_BOT_TOKEN` and at least one AI API key.
3. If your network uses Kaspersky HTTPS inspection, put the exported PEM root CA at `certs/kaspersky-root-ca.crt`.
4. `docker compose build --no-cache nodered`
5. `docker compose up -d`
6. Open Node-RED at http://localhost:1880 and import `flows/ai-integrator-v3.2-multi-provider.json`.
7. Configure the Telegram bot credentials in the imported flow if required by node-red-contrib-telegrambot.

## Important
Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`. The Dockerfile trusts the Kaspersky root CA explicitly.
