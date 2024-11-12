FROM oven/bun:canary-debian

# Install necessary packages (no need for xvfb or a window manager)
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium htop procps net-tools iproute2 grep dbus sudo x11-xserver-utils mesa-utils dbus-x11 && \
    rm -rf /var/lib/apt/lists/*
    
RUN useradd -m hello

# Copy your Bun.sh script
COPY ./ /app/

# Change ownership of /app to the 'bun' user
RUN chown -R hello:hello /app

# Make the startup script executable 
RUN chmod +x /app/gluworld/index.ts

# Create a startup script (using bun)
COPY ./shell/start-chromium /usr/local/bin/

RUN chmod +x /usr/local/bin/start-chromium

# Set the startup command
CMD ["/usr/local/bin/start-chromium"]