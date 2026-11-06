FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY LICENSE ./LICENSE
ENV NODE_ENV=production SUPERZOO_TRANSPORT=http SUPERZOO_HOST=0.0.0.0 SUPERZOO_PORT=3000
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
