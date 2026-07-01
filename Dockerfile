# syntax=docker/dockerfile:1

# ---- build: install deps, build the SPA, fetch the Linux PocketBase binary ----
FROM oven/bun:1 AS build
ARG PB_VERSION=0.39.5
WORKDIR /app

# Workspace manifests first (better layer caching for `bun install`).
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/cli/package.json packages/cli/
COPY packages/installer/package.json packages/installer/
COPY apps/board/package.json apps/board/
RUN bun install --frozen-lockfile

# Sources + build the board.
COPY . .
RUN bun run build:board

# Fetch the platform-correct PocketBase binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ARCH="$(dpkg --print-architecture)" \
 && case "$ARCH" in amd64) PBARCH=amd64 ;; arm64) PBARCH=arm64 ;; *) PBARCH=amd64 ;; esac \
 && curl -sSL -o /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PBARCH}.zip" \
 && unzip -o /tmp/pb.zip pocketbase -d /pb \
 && chmod +x /pb/pocketbase

# ---- runtime: static PocketBase serving API + the built SPA -------------------
FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates
WORKDIR /pb

COPY --from=build /pb/pocketbase /pb/pocketbase
COPY --from=build /app/pb/pb_migrations /pb/pb_migrations
COPY --from=build /app/apps/board/dist /pb/pb_public
COPY docker-entrypoint.sh /pb/docker-entrypoint.sh
RUN chmod +x /pb/docker-entrypoint.sh

EXPOSE 8090
# Migrations auto-apply on serve; --indexFallback (default) handles SPA deep links.
ENTRYPOINT ["/pb/docker-entrypoint.sh"]
