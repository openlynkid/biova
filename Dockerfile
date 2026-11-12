FROM oven/bun:1.4.4 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY plugins ./plugins
COPY turbo.json tsconfig.json bunfig.toml ./
RUN bun install --frozen-lockfile
RUN bun run --filter @openlynk/web build

FROM oven/bun:1.4.4 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app /app
EXPOSE 3000
CMD ["bun", "run", "--filter", "@openlynk/web", "start"]
