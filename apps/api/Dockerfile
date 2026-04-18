# Production API: compile TypeScript, run Node (no tsx in CMD)
FROM public.ecr.aws/docker/library/node:20-alpine
RUN apk add --no-cache postgresql-client curl
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY sql ./sql
COPY src ./src
RUN npm run build
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
