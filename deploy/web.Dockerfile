# syntax=docker/dockerfile:1.7
#
# Images for a self-hosted Orbit (docs/SELF_HOSTING.md). Built by `deploy/orbit` from the
# repository root as the build context; two targets:
#
#   web    the Next.js app, as Next's standalone server (next.config.ts, NEXT_OUTPUT=standalone)
#   tools  Node, the repository's own Supabase CLI and psql: applies migrations and deploy.sql
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build arguments and every
# instance builds its own web image -- that is why the image is built on the server by default.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The Supabase CLI package downloads its binary in postinstall; the tools image needs it.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
# Measured on this app: the build peaks at ~3.0 GB of RAM as is, ~2.0 GB without the type check (CI
# has already run it on every commit that reaches main) and with one build worker -- and is no
# slower. That is what lets a 2 GB server with swap build it next to the running stack.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ARG NEXT_PUBLIC_EXTENSION_ID=""
ARG NEXT_PUBLIC_APP_VERSION=""
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY} \
    NEXT_PUBLIC_EXTENSION_ID=${NEXT_PUBLIC_EXTENSION_ID} \
    NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    ORBIT_SKIP_BUILD_TYPECHECK=1 \
    ORBIT_BUILD_CPUS=1
COPY . .
RUN npx next build

FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Next's file tracing keeps only @swc/helpers' cjs build, but the compiled server also requires its
# esm files at start-up (MODULE_NOT_FOUND .../@swc/helpers/esm/_interop_require_default.js).
COPY --from=build /app/node_modules/@swc/helpers ./node_modules/@swc/helpers
# The image optimizer writes .next/cache/images at run time, as the unprivileged user below.
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM deps AS tools
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY supabase ./supabase
COPY deploy/lib/migrate.sh deploy/lib/quiet.psqlrc ./deploy/lib/
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}
ENTRYPOINT ["bash", "/app/deploy/lib/migrate.sh"]
