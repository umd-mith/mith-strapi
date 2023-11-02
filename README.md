# mith-directus

Populate a directus instance from MITH AirTable YAML exports.

## Installation

`docker-compose.yml` provides an example installation and setup for directus' latest Docker image.

Make sure to **change the credentials in `.env`**

Once the instance is setup (locally, or somehwere else), you can install and run the Node script to popoulate the data. 

With node >18:

```sh
npm install
```

## Usage

The Node program is written in TypeScript. You can run it directly with `ts-node` (provided) or build it first.

### Run with ts-node

```sh
npm run populate -- [options] <input-folder>
```

```
Options:
  -V, --version              output the version number
  -d, --directus <URL>       URL to directus instance (default: "http://0.0.0.0:8055")
  -u, --user <username>      directus user name
  -p, --password <password>  directus password
  -r, --replace              replace existing collections with new data instead of merging (NB removes all tables!) (default: false)
  -h, --help                 display help for command
```


### Build then run

```sh
npm run build
node dist/index.js [options] <input-folder>
```
