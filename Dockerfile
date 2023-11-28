# syntax = docker/dockerfile:1

FROM directus/directus:10.8.2
USER root

# Install sqlite3 to allow access to the database CLI for debugging
RUN apk add --no-cache sqlite

RUN mkdir -p /data
VOLUME /data

# Copy initialization script to
# create the actual database and uploads directory under /data
COPY init-script.sh /usr/local/bin/init-script.sh
RUN chmod +x /usr/local/bin/init-script.sh

ENV STORAGE_LOCAL_ROOT=/data/uploads \
    DB_FILENAME=/data/database/data.db \
    HOST="0.0.0.0"

RUN chown -R node:node /data

USER node

# Set the initialization script to run when the container starts
ENTRYPOINT ["/usr/local/bin/init-script.sh"]

# Default command to run (from the base image)
CMD ["/bin/sh", "-c", "node cli.js bootstrap && pm2-runtime start ecosystem.config.cjs"]

EXPOSE 8055
