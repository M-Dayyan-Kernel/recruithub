# Build context is the REPO ROOT (docker-compose.app.yml sets it), not ./candidate-app,
# because this image also packages ../chrome-extension. The zip served to candidates is
# therefore always built from the extension source in the same commit as this app.
# Which files are in the context is decided by the repo-root .dockerignore.

# Extension zip + latest.json, built by the same script developers run (`npm run package`).
FROM alpine:3.20 AS extension
RUN apk add --no-cache zip
COPY chrome-extension /extension
RUN sh /extension/scripts/package.sh /extension /out

FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

# Without an extension ID the production build fails closed ("check not set up").
ARG VITE_RH_EXTENSION_ID=
ENV VITE_RH_EXTENSION_ID=$VITE_RH_EXTENSION_ID
ARG VITE_RH_EXTENSION_INSTALL_URL=
ENV VITE_RH_EXTENSION_INSTALL_URL=$VITE_RH_EXTENSION_INSTALL_URL

COPY candidate-app/package.json candidate-app/package-lock.json ./
RUN npm ci

COPY candidate-app/ .
RUN npm run build

FROM nginx:alpine
COPY candidate-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=extension /out /usr/share/nginx/html/extension
EXPOSE 80
