# OpenReply — self-hosted Docker image
#
# Two runtime processes ship from this image:
#   - web:    `npm run start`
#   - worker: `npm run worker` (runs the TypeScript worker with tsx)
#   - cron:   `sh scripts/cron.sh`

FROM node:20-slim AS build
WORKDIR /app

# This repository deliberately has no package-lock.json, so use npm install
# rather than npm ci. The installed dependency tree remains isolated to the
# image build and is copied into the runtime image below.
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/app/generated ./app/generated
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "run", "start"]
