# syntax=docker/dockerfile:1
FROM node:24.11.0-alpine@sha256:f36fed0b2129a8492535e2853c64fbdbd2d29dc1219ee3217023ca48aebd3787 AS build
WORKDIR /build
COPY package.json package-lock.json ./
# Optional CA mount supports managed development proxies without baking trust in.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --no-audit --no-fund; \
    else npm ci --no-audit --no-fund; fi
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236 AS runtime
COPY --from=build --chown=101:101 /build/dist /opt/qwen-image-studio/current
COPY --chmod=644 nginx/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=644 nginx/server.conf nginx/http.conf.template nginx/site-auth.conf /etc/qwen-image-studio/
COPY --chmod=755 nginx/start.sh /usr/local/bin/qwen-start
RUN chmod 755 /etc/qwen-image-studio
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/qwen-start"]
