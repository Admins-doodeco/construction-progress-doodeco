FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and OpenSSL (required for Prisma)
RUN apk add --no-cache openssl
RUN npm install

# Copy prisma directory
COPY prisma ./prisma

# Generate Prisma Client for the alpine container
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Expose port (Cloud Run will inject process.env.PORT, default to 8080)
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
