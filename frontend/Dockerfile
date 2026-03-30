ARG NPM_REGISTRY=
FROM node:20-alpine AS builder

ARG NPM_REGISTRY
WORKDIR /app

COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci

COPY . .

ARG VITE_API_BASE_URL=/api
ARG ALPINE_MIRROR=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM nginx:alpine

ARG ALPINE_MIRROR=

RUN if [ -n "$ALPINE_MIRROR" ]; then \
      sed -i "s|https\?://dl-cdn.alpinelinux.org/alpine|$ALPINE_MIRROR|g" /etc/apk/repositories; \
    fi \
 && apk add --no-cache tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

ENV TZ=Asia/Shanghai

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
