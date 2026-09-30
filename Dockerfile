FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
# All data (SQLite database + uploaded photos) lives in /data: mount a persistent volume there.
ENV NODE_ENV=production AVANTRO_DATA=/data HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
