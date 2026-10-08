FROM node:20-slim
WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

# Data now lives in PostgreSQL. Provide a connection string at run time:
#   -e DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
# Uploads/backups still use /app/data — mount a volume there to keep uploads:
#   docker run -v eventplaybook-data:/app/data ...
ENV PORT=3000
ENV DATA_DIR=/app/data
# Set a real secret at run time:  -e JWT_SECRET=your-long-random-string
# and enable production safety checks:  -e NODE_ENV=production
EXPOSE 3000

# The app auto-seeds demo data on first boot if the database is empty.
CMD ["node", "server/index.js"]
