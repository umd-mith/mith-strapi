# Dockerfile
FROM node:20
# Installing libvips-dev for sharp Compatibility
RUN apt-get update && apt-get install libvips-dev -y
# Create the database data directory and set it to its own volume
RUN mkdir -p /data
VOLUME /data
# Copy the configuration files
WORKDIR /opt/
COPY ./package.json ./package-lock.json ./
ENV PATH /opt/node_modules/.bin:$PATH
# Install dependencies
RUN npm install
# Copy the application files
WORKDIR /opt/app
COPY ./ .
# Build the Strapi application
RUN npm run build
# Expose the Strapi port
EXPOSE 1337
# Start the Strapi application
CMD ["npm", "start"]