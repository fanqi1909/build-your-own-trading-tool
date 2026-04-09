FROM node:20-slim

WORKDIR /app

# Install okx CLI globally (trade-dashboard depends on it)
RUN npm install -g @okx_ai/okx-trade-cli@1.2.4

# Install Python for analyze.py
RUN apt-get update && apt-get install -y --no-install-recommends python3 && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json ./
RUN npm install

# Copy source (overridden by volume mount in dev)
COPY . .

# Data volume for persistence
VOLUME /app/data

EXPOSE 3000

CMD ["/bin/sh", "start.sh"]
