FROM node:20-slim

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create directories for uploads and data
RUN mkdir -p uploads/templates uploads/packets uploads/signatures signed data

# Expose port
EXPOSE 3001

# Run migrations and start server
CMD npx prisma migrate deploy && npm start
