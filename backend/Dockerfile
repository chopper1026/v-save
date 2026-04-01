ARG NPM_REGISTRY=
ARG APT_MIRROR=
ARG APT_SECURITY_MIRROR=
FROM node:20-bookworm-slim AS builder

ARG NPM_REGISTRY
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
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
 && apt-get -o Acquire::Retries=5 install -y --fix-missing --no-install-recommends \
    ca-certificates \
    python3 \
    python3-venv \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci \
 && python3 -m venv /opt/douyin-python \
 && if [ -n "$PIP_INDEX_URL" ]; then \
      /opt/douyin-python/bin/pip install --no-cache-dir -i "$PIP_INDEX_URL" --upgrade pip; \
      /opt/douyin-python/bin/pip install --no-cache-dir -i "$PIP_INDEX_URL" gmssl; \
    else \
      /opt/douyin-python/bin/pip install --no-cache-dir --upgrade pip; \
      /opt/douyin-python/bin/pip install --no-cache-dir gmssl; \
    fi

COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force \
 && rm -rf /root/.npm \
 && find dist -type f \( -name '*.map' -o -name '*.d.ts' \) -delete

FROM node:20-bookworm-slim AS runner

ARG APT_MIRROR=
ARG APT_SECURITY_MIRROR=
ARG YTDLP_DOWNLOAD_URL=https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
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
 && apt-get -o Acquire::Retries=5 install -y --fix-missing --no-install-recommends \
    ffmpeg \
    python3 \
    ca-certificates \
    tzdata \
 && python3 -c "import os, urllib.request; urllib.request.urlretrieve(os.environ['YTDLP_DOWNLOAD_URL'], '/usr/local/bin/yt-dlp')" \
 && chmod +x /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/share/doc/* /usr/share/man/* /tmp/* \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /opt/douyin-python /opt/douyin-python
COPY tools/douyin/abogus.py ./tools/douyin/abogus.py

ENV NODE_ENV=production
ENV PORT=3001
ENV TZ=Asia/Shanghai
ENV FFMPEG_PATH=ffmpeg
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV PATH=/opt/douyin-python/bin:$PATH
ENV DOUYIN_ABOGUS_HELPER_PATH=/app/tools/douyin/abogus.py

EXPOSE 3001

CMD ["node", "dist/main"]
