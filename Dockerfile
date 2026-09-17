FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV TZ=Asia/Shanghai

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN /app/node_modules/ffmpeg-static/ffmpeg -version > /dev/null
RUN mkdir -p /app/data /app/recordings

EXPOSE 4173

CMD ["node", "server/index.js"]
