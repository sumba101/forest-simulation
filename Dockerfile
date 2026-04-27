# Use the official Bun image as our base
FROM oven/bun:1

# Install curl, jq (to parse JSON), and xz-utils (to extract Zig)
RUN apt-get update && apt-get install -y curl jq xz-utils && rm -rf /var/lib/apt/lists/*

# Dynamically fetch and install the LATEST nightly build of Zig (0.16.0-dev)
# Fixed jq quote escaping and added safety checks
RUN ARCH=$(uname -m) && \
    echo "Detected architecture: ${ARCH}" && \
    URL=$(curl -s https://ziglang.org/download/index.json | jq -r '.master["'"${ARCH}"'-linux"].tarball') && \
    echo "Downloading Zig from: ${URL}" && \
    if [ "$URL" = "null" ] || [ -z "$URL" ]; then echo "Error: Could not parse Zig URL." && exit 1; fi && \
    curl -sL "$URL" -o zig.tar.xz && \
    tar -xf zig.tar.xz && \
    mv  zig-aarch64-linux* /usr/local/zig && \
    ln -s /usr/local/zig/zig /usr/local/bin/zig && \
    rm zig.tar.xz

# Set the working directory for the app
WORKDIR /app

# Copy the entire project into the container
COPY . .

# 1. Build the simulation library in the /sim directory
WORKDIR /app/sim
RUN zig build -Doptimize=ReleaseFast

# 2. Set working directory to the server for running
WORKDIR /app/server

# Install server dependencies
RUN bun install

# Expose the port the WebSocket/HTTP server runs on
EXPOSE 3000

# Start the server
CMD ["bun", "run", "index.ts"]
