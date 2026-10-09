FROM node:20-slim

# better-sqlite3 uses a native addon. These build tools are only needed during
# npm install; they also let the image build on hosts without a prebuilt binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# SQLite database, uploads, and local backup snapshots live here inside the app.
# The app runs with Render and the local SQLite file only.
ENV PORT=3000
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server/index.js"]
