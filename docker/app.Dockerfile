# One image for the platform: the pinned Hermes Agent release (Python 3.14 + Node) with the NestJS API
# and the built Vue app on top. NestJS spawns `hermes` as a subprocess for each trial.
FROM nousresearch/hermes-agent:v0.22.7

USER root
RUN npm install -g --prefix /usr/local pnpm@12.16.1

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm build && chown -R hermes:hermes /app

# Run as Hermes' unprivileged user: its launcher drops root to this uid anyway, and trial
# directories must be owned by the same user that runs the agent.
USER hermes
ENV NODE_ENV=production

EXPOSE 3001
# Bypass the image's s6 supervisor (it would start Hermes' own gateway, which we don't use).
ENTRYPOINT ["node", "apps/api/dist/main.js"]
