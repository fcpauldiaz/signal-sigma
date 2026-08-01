FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* pnpm-lock.yaml* ./
COPY ui/package.json ui/pnpm-lock.yaml* ./ui/

RUN npm install -g pnpm \
  && pnpm install \
  && cd ui && pnpm install && cd ..

RUN npx playwright install chromium --with-deps || true

COPY . .

RUN pnpm run build:ui && pnpm run build

ENV NODE_ENV=production
ENV UI_PORT=3000
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "dist/serve.js"]
