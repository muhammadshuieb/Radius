# Production web: Vite build + static server (no dev server)
# Browser must reach the API by absolute URL — `serve` does not proxy /api.
# Override at build time: docker compose build --build-arg VITE_API_URL=http://host:4000 web
FROM public.ecr.aws/docker/library/node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
EXPOSE 5174
ENV NODE_ENV=production
CMD ["serve", "-s", "dist", "-l", "5174", "--no-port-switching"]
