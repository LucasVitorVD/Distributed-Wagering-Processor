FROM oven/bun:1.4.4 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN bun run build

FROM oven/bun:1.4.4 AS production-dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM node:24-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
