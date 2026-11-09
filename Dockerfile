FROM ubuntu:24.04

# Install Node.js 18 from NodeSource (official)
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install build tools (just in case)
RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY src/server /app/server

RUN npm install

ARG PORT=7000
EXPOSE $PORT

CMD ["node", "server/server.js"]