#!/bin/sh
# Check if the directories exist, if not, create them
[ ! -d "/data/database" ] && mkdir -p /data/database
[ ! -d "/data/uploads" ] && mkdir -p /data/uploads

# Execute the main command of the container
exec "$@"
