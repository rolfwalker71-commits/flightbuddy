FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/flightbuddy.sqlite
VOLUME /data
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
