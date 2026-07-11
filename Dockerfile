# =========================
# Base Stage
# =========================
FROM node:22.13-alpine AS base

WORKDIR /usr/app

# Enable corepack (recommended instead of npm global pnpm install)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy dependency files first (better caching)
COPY package.json tsconfig.json pnpm-lock.yaml ./

# Copy shared/library code
COPY library ./library

# Install dependencies
RUN pnpm install

# Copy source code
COPY src ./src

# Build project
RUN pnpm run build

# Verify build output
RUN ls -la dist/


# =========================
# Development Stage
# =========================
FROM base AS development

WORKDIR /usr/app

# Create upload directories
RUN mkdir -p uploads/temp uploads/contacts uploads/media

EXPOSE 8000

CMD ["pnpm", "run", "dev"]


# =========================
# Production Stage
# =========================
FROM node:22.13-alpine AS production

WORKDIR /usr/app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy dependency files
COPY package.json tsconfig.json pnpm-lock.yaml ./
COPY library ./library

# Install ONLY production dependencies
RUN pnpm install --prod

# Copy built output from base stage
COPY --from=base /usr/app/dist ./dist

# Copy startup script
COPY start-all.sh ./
RUN chmod +x start-all.sh

# Create upload directories
RUN mkdir -p uploads/temp uploads/contacts uploads/media

ENV PORT=8000

EXPOSE 8000

CMD ["./start-all.sh"]

# # =========================
# # Base Stage
# # =========================
# FROM node:20.15.0-alpine AS base

# # Working directory
# WORKDIR /usr/app

# # Install pnpm
# RUN npm install -g pnpm

# # Copy package files
# COPY package.json tsconfig.json ./
# COPY library ./library

# # Install dependencies
# RUN pnpm install

# # Copy source
# COPY src ./src

# # Build app
# RUN pnpm run build

# # Debug
# RUN ls -la dist/

# # =========================
# # Development Stage
# # =========================
# FROM base AS development

# # Create upload directories
# RUN mkdir -p /usr/app/uploads/temp
# RUN mkdir -p /usr/app/uploads/contacts
# RUN mkdir -p /usr/app/uploads/media

# EXPOSE 8000

# CMD ["pnpm", "run", "dev"]

# # =========================
# # Production Stage
# # =========================
# FROM node:20.15.0-alpine AS production

# WORKDIR /usr/app

# # Install pnpm
# RUN npm install -g pnpm

# # Copy package files
# COPY package.json tsconfig.json ./
# COPY library ./library

# # Install production dependencies
# RUN pnpm install --production

# # Copy build files
# COPY --from=base /usr/app/dist ./dist

# # Copy startup script
# COPY start-all.sh ./

# # Make executable
# RUN chmod +x start-all.sh

# # Create upload directories
# RUN mkdir -p /usr/app/uploads/temp
# RUN mkdir -p /usr/app/uploads/contacts
# RUN mkdir -p /usr/app/uploads/media

# # Environment
# ENV PORT=8000

# # Expose app port
# EXPOSE 8000

# # Start app
# CMD ["./start-all.sh"]




# # =========================
# # Base dependencies stage
# # =========================
# FROM node:20-alpine AS base

# WORKDIR /usr/app

# # Install system deps (important for pg, bcrypt, etc.)
# RUN apk add --no-cache libc6-compat

# # Enable pnpm
# RUN corepack enable && corepack prepare pnpm@latest --activate

# # Copy dependency files first (better caching)
# COPY package.json pnpm-lock.yaml tsconfig.json ./

# # Copy internal packages
# COPY library ./library

# # Install ALL dependencies for build
# RUN pnpm install --frozen-lockfile

# # =========================
# # Build stage
# # =========================
# FROM base AS builder

# WORKDIR /usr/app

# COPY src ./src

# # Build TypeScript
# RUN pnpm run build

# # =========================
# # Production stage
# # =========================
# FROM node:20-alpine AS production

# WORKDIR /usr/app

# # Install runtime system deps
# RUN apk add --no-cache libc6-compat tini

# # Enable pnpm
# RUN corepack enable && corepack prepare pnpm@latest --activate

# # Set environment
# ENV NODE_ENV=production
# ENV PORT=8001

# # Create non-root user
# RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# # Copy package files
# COPY package.json pnpm-lock.yaml ./

# # Install ONLY production deps
# RUN pnpm install --prod --frozen-lockfile

# # Copy build output
# COPY --from=builder /usr/app/dist ./dist

# # Copy library if needed at runtime
# COPY --from=builder /usr/app/library ./library

# # Copy startup script
# COPY start-all.sh ./

# # Create upload folders
# RUN mkdir -p uploads/temp uploads/contacts uploads/media

# # Fix permissions
# RUN chmod +x start-all.sh && chown -R appuser:appgroup /usr/app

# USER appuser

# EXPOSE 8001

# # Healthcheck (important for production)
# HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
#   CMD wget -q --spider http://localhost:8001/health || exit 1

# ENTRYPOINT ["/sbin/tini", "--"]

# CMD ["./start-all.sh"]