# Docker image for the Port Said scraper backend.
#
# Use this if Render's native Node runtime fails to launch Chromium (missing
# system libs). The base image is Microsoft's official Playwright image,
# which ships Chromium + every required apt package pre-installed.
#
# To switch Render onto this image:
#   1. Render dashboard → your service → Settings → Build & Deploy
#   2. Change "Runtime" from Node to Docker
#   3. Save → Manual Deploy → Deploy latest commit

# Pin to the exact version of Playwright we use in package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Install deps first so the layer is cached when only source files change.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the source.
COPY . .

# Render injects PORT at runtime; default 8080 for local container runs.
ENV PORT=8080
EXPOSE 8080

# The Playwright base image already lives in /ms-playwright; tell Playwright
# to use the system-installed browsers instead of looking in node_modules.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "src/server/index.js"]
