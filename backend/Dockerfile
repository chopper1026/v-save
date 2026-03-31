ARG NPM_REGISTRY=
ARG APT_MIRROR=
ARG APT_SECURITY_MIRROR=
FROM node:20-bookworm-slim AS builder

ARG NPM_REGISTRY
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
WORKDIR /app

RUN if [ -n "$APT_MIRROR" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|http://deb.debian.org/debian|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
        if [ -n "$APT_SECURITY_MIRROR" ]; then \
          sed -i "s|http://security.debian.org/debian-security|$APT_SECURITY_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
        fi; \
      fi; \
      if [ -f /etc/apt/sources.list ]; then \
        sed -i "s|http://deb.debian.org/debian|$APT_MIRROR|g" /etc/apt/sources.list; \
        if [ -n "$APT_SECURITY_MIRROR" ]; then \
          sed -i "s|http://security.debian.org/debian-security|$APT_SECURITY_MIRROR|g" /etc/apt/sources.list; \
        fi; \
      fi; \
    fi \
 && apt-get -o Acquire::Retries=5 update \
 && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

ARG APT_MIRROR=
ARG APT_SECURITY_MIRROR=
ARG NPM_REGISTRY=
ARG PIP_INDEX_URL=
WORKDIR /app

RUN if [ -n "$APT_MIRROR" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|http://deb.debian.org/debian|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
        if [ -n "$APT_SECURITY_MIRROR" ]; then \
          sed -i "s|http://security.debian.org/debian-security|$APT_SECURITY_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
        fi; \
      fi; \
      if [ -f /etc/apt/sources.list ]; then \
        sed -i "s|http://deb.debian.org/debian|$APT_MIRROR|g" /etc/apt/sources.list; \
        if [ -n "$APT_SECURITY_MIRROR" ]; then \
          sed -i "s|http://security.debian.org/debian-security|$APT_SECURITY_MIRROR|g" /etc/apt/sources.list; \
        fi; \
      fi; \
    fi \
 && apt-get -o Acquire::Retries=5 update \
 && apt-get install -y --fix-missing --no-install-recommends \
    ffmpeg \
    yt-dlp \
    curl \
    chromium \
    python3 \
    make \
    g++ \
    python3-venv \
    ca-certificates \
    tzdata \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
 && python3 -m venv /opt/douyin-python \
 && if [ -n "$PIP_INDEX_URL" ]; then \
      /opt/douyin-python/bin/pip install --no-cache-dir -i "$PIP_INDEX_URL" --upgrade pip; \
      /opt/douyin-python/bin/pip install --no-cache-dir -i "$PIP_INDEX_URL" gmssl; \
    else \
      /opt/douyin-python/bin/pip install --no-cache-dir --upgrade pip; \
      /opt/douyin-python/bin/pip install --no-cache-dir gmssl; \
    fi \
 && rm -rf /var/lib/apt/lists/* \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY tools/douyin/abogus.py ./tools/douyin/abogus.py

ENV NODE_ENV=production
ENV PORT=3001
ENV TZ=Asia/Shanghai
ENV FFMPEG_PATH=ffmpeg
ENV YTDLP_PATH=yt-dlp
ENV PATH=/opt/douyin-python/bin:$PATH
ENV DOUYIN_ABOGUS_HELPER_PATH=/app/tools/douyin/abogus.py
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3001

CMD ["npm", "run", "start:prod"]
