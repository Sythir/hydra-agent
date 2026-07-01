# syntax=docker/dockerfile:1
# Base image
FROM node:22

# Create app directory
WORKDIR /usr/src/app

# .npmrc points the @sythir scope at GitHub Packages; it must be present before
# install so @sythir/config-merger can be fetched.
COPY package*.json .npmrc ./

RUN corepack enable && corepack prepare pnpm@latest-9 --activate && pnpm config set store-dir .pnpm-store

# Install app dependencies. The GitHub Packages token is provided as a BuildKit
# secret (not an ARG/ENV) so it is not baked into the image layers. Build with:
#   DOCKER_BUILDKIT=1 docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN .
RUN --mount=type=secret,id=node_auth_token \
    export NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" && pnpm install

# Bundle app source
COPY . .

# Creates a "dist" folder with the production build
RUN pnpm run build

# Expose the port on which the app will run
EXPOSE 3000

# Start the server using the production build
CMD ["npm", "run", "start"]
