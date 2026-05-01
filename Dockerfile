FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=8787
ENV STORAGE_DIR=/app/storage
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/qle-formatter.js ./qle-formatter.js
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/qle-formatter-deps ./qle-formatter-deps
COPY --from=build /app/storage ./storage
EXPOSE 8787
CMD ["npm", "start"]
