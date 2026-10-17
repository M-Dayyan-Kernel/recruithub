FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

# Without an extension ID the production build fails closed ("check not set up").
ARG VITE_RH_EXTENSION_ID=
ENV VITE_RH_EXTENSION_ID=$VITE_RH_EXTENSION_ID
ARG VITE_RH_EXTENSION_INSTALL_URL=
ENV VITE_RH_EXTENSION_INSTALL_URL=$VITE_RH_EXTENSION_INSTALL_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
