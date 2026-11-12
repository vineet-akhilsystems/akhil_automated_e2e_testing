# syntax=docker/dockerfile:1
# Augastam Test Studio - production image (Node 24, Playwright Chromium, Python PDF renderer).
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORTAL_HOST=0.0.0.0 \
    PORTAL_PORT=4173 \
    PORTAL_DATA_DIR=/data/.portal \
    PORTAL_PYTHON=/opt/venv/bin/python \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System packages: Python for the PDF renderer, fonts, tini as PID 1.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates fonts-dejavu-core tini \
 && rm -rf /var/lib/apt/lists/*

COPY portal/requirements-report.txt portal/requirements-report.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install -r portal/requirements-report.txt

# Dependencies first for layer caching. Dev dependencies are required: the runner uses @playwright/test.
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright

COPY . .

# Non-root runtime user; /data holds the persistent .portal directory, /app/.auth the browser sessions.
RUN mkdir -p /data/.portal /app/.auth /app/test-results /app/playwright-report \
 && chown -R node:node /data /app/.auth /app/test-results /app/playwright-report \
 && chown node:node /app
USER node

VOLUME ["/data"]
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORTAL_PORT||4173)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "portal/server.mjs"]
