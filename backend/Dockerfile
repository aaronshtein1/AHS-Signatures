FROM node:20-alpine

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

# Create directories for uploads
RUN mkdir -p uploads/templates uploads/signatures signed

# Expose port
EXPOSE 3001

# Start server
CMD ["npm", "start"]
