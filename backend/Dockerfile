FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN apt-get -o Acquire::Retries=5 update \
 && apt-get install -y --fix-missing --no-install-recommends \
    ffmpeg \
    yt-dlp \
    curl \
    chromium \
    python3 \
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
 && /opt/douyin-python/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/douyin-python/bin/pip install --no-cache-dir gmssl \
 && rm -rf /var/lib/apt/lists/* \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

COPY package*.json ./
RUN npm ci --omit=dev

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
