import { Command } from "commander";
import type { OptionValues } from "commander";
import * as fs from "fs";
const pfs = fs.promises;
import * as path from "path";
import YAML from "yaml";
import dotenv from "dotenv";
dotenv.config();
import { 
  createDirectus,
  authentication,
  rest,
  readCollection,
  createCollection,
  deleteCollection,
  readCollections,
  createItem,
  updateItem,
  createRelation,
  readRelation,
  createField,
  readField,
  readItems,
  importFile
} from "@directus/sdk";
import type { Query } from "@directus/sdk";

type FieldType = "integer" | "float" | "string" | "timestamp" | "uuid" | "text" | "alias";

interface ColField {
  field: string
  type: FieldType
  meta?: {
    icon?: string,
    interface?: "file-image" | "input-rich-text-md" | "list-m2m",
    special?: ["file" | "m2m"],
    options?: {
      layout?: "list",
      "fields"?: string[]
      crop?: boolean
    }
  }
  schema: {
    is_primary_key: boolean
    is_nullable: boolean
    is_unique?: boolean
  }
}

interface Relationships {
  [key: string]: {
    all: string[]
    items: {
      id: string,
      [key: string]: unknown
    }[]
  }
}

interface FieldAcc {
  failed: string[]
  succeeded: string[]
  fields: ColField[]
  relationships: Relationships
}

interface ProgramOptions extends OptionValues {
  directus: string
  user: string
  password: string
  replace: boolean
}

/* The `extractYmlFields` function takes in the name of a collection and an array of YAML
objects. It iterates over each object in the array and extracts the fields based on the data
provided. */
const extractYmlFields: (yml: {[key: string]: unknown}[]) => [ColField[], Relationships] = (yml) => {
  // Determine fields based on the data provided (as list of objects) 
  const data = yml.reduce((acc: FieldAcc, entry) => {
    for (const k in entry) {
      const safeKey = k.replace(/[()]/g, "").replace(" as ", " ").replace(/\s+/g, "_");
      if (acc.failed.includes(k) || acc.succeeded.includes(k)) continue;
      const field: ColField = {
        field: safeKey,
        type: "string",
        meta: {},
        schema: {
          is_primary_key: safeKey === "id",
          is_nullable: safeKey !== "id"
        }
      };
      switch(typeof entry[k]) {
      case "number":
        field.type = Number.isInteger(entry[k]) ? "integer" : "float";
        break;
      case "object":
        if (Array.isArray(entry[k])) {
          // If it's an array of strings, this may be O2M field, otherwise use text.
          const e = entry[k] as unknown[];
          if (e.length === 0 || typeof e[0] === "string") {
            if ((e[0] as string).match(/^rec/)) {
              // keep track of this field so that relationships can be determined later
              acc.relationships[safeKey]= {
                all: [],
                items: []
              };
              continue; // do not record this field as it needs to be handled together with relationships
            } else {
              field.type = "text";
            }
            break;
          } else if (e[0] && !!Object.getOwnPropertyDescriptor(e[0], "type")) {
            // But if it's an array of objects, try to determine if it's an image field
            // NB only the first image will be migrated.
            const typedE = e[0] as {[key: string] : string};
            if (typedE.type.includes("image")) {
              field.type = "uuid";
              field.meta = {
                interface: "file-image",
                special: ["file"],
                options: {
                  crop: false
                }
              };
            }
            break;
          }
        }
        console.warn(`Could not parse key "${k}" (as ${safeKey})`);
        acc.failed.push(k);
        continue;
      case "string":
        // check if it's a long text 
        if ((entry[k] as string).trim().includes("\n") || (entry[k] as string).length > 100) {
          field.type = "text";
          field.meta = {
            interface: "input-rich-text-md"
          };
        }
        // check if it's a date (this triggers only if the string starts with a digit to avoid false positives)
        else if ((entry[k] as string).match(/^\d/) && !isNaN(new Date(entry[k] as string).getTime())) {
          field.type = "timestamp";
        }
        break;
      default:
        field.type = "string";
      }
      acc.succeeded.push(k);
      acc.fields.push(field);
    }
    return acc;
  }, {
    failed: [],
    succeeded: [],
    fields: [],
    relationships: {}
  });

  if (!data.succeeded.includes("id")) {
    // We always need an ID field, so make sure to create it
    data.fields.push({
      field: "id",
      type: "string",
      meta: {},
      schema: {
        is_primary_key: true,
        is_nullable: false,
      }
    });
  }
  
  return [data.fields, data.relationships];
};

/**
 * The `populate` function is responsible for populating Directus collections with data from YAML
 * files, creating collections and fields as needed, and establishing relationships between
 * collections.
 * @param {string} dir - The `dir` parameter is a string that represents the directory path where the
 * YAML files are located. These YAML files contain data that will be used to populate collections in
 * Directus.
 * @param {OptionValues} opts - The `opts` parameter is an object that contains the following
 * properties:
 *   directus "URL to directus instance", default: "http://0.0.0.0:8055")
 *   user "directus user name"
 *   password <password>
 *   replace "replace existing collections with new data instead of merging (NB removes all tables!)", default false
 */
const populate = async (dir: string, opts: ProgramOptions) => {
  const directusURL = opts.directus;
  const username = opts.user ?? process.env.DIRECTUS_USERNAME;
  const password = opts.password ?? process.env.DIRECTUS_PASSWORD;
  if (!username || !password) {
    console.error("directus user name or password not provided");
    process.exit(1);
  }

  const replace = opts.replace;

  // Setup client and connect
  const client = createDirectus(directusURL).with(authentication()).with(rest());
  await client.login(username, password);

  // drop all existing tables in mode replace
  if (replace) {
    const cols = await client.request(readCollections());
    for (const c of cols) {
      if (c.collection.startsWith("directus_")) continue;
      await client.request(deleteCollection(c.collection));
    }

  }

  // Find full path to input dir
  const inputDir = path.join(process.cwd(), dir);
  
  // Check that we have a directory.
  if (!(await pfs.lstat(inputDir)).isDirectory()) {
    console.error(`Error: ${inputDir} is not a directory.`);
    process.exit(1);
  }

  // Get all .yml files
  const files = (await pfs.readdir(inputDir)).filter(f => path.extname(f) === ".yml");

  // Keep track of airtable_ids for relationship building
  const relationshipTargets: {[key: string]: string} = { };
  const relationshipFields: {[key: string]: Relationships} = { };

  for (const file of files) {
    // get file content and parse as YAML
    const fileData: string = (await pfs.readFile(path.join(inputDir, file))).toString();
    const yData = YAML.parse(fileData);

    const collName = path.parse(file).name;

    // Create collection if needed
    const collection = await client.request(readCollection(collName))
      .catch(() => console.error(`Could not retrieve collection ${collName}, will create it.`));
    
    if (collection && replace) {
      // Delete collection if in replace mode.
      console.info(`Deleting collection ${collName} (mode replace)`);
      await client.request(deleteCollection(collName)).catch(err => console.error(err));
    }

    if (!collection || collection && replace) {
      console.info(`🏗 Creating collection ${collName}`);
      const [fields, relationships] = extractYmlFields(yData);
      relationshipFields[collName] = relationships;
      
      await client.request(
        createCollection({
          collection: collName,
          // Providing a dummy schema object is essential for the collection to be created as a _collection_ instead of a _folder_
          // This is NOT documented in the API. See: https://github.com/directus/directus/issues/10407#issuecomment-989498025
          schema: { 
            schema: collName,
            name: collName,
            comment: collName,
          },
          meta: {
            hidden: false,
            singleton: false,
          },
          fields,
        })
      ).catch(err => console.error(`Error creating collection ${collName}`, err));
    }
    
    console.info(`📂 Populating collection ${collName}`);

    const ids: string[] = [];
    for (const rawItem of yData) {
      const item: {airtable_id: string, id: string, [key: string]: unknown} = {
        airtable_id: rawItem.airtable_id,
        id: rawItem.id
      };
      for (const rik in rawItem) {
        if (rik === "airtable_id" || rik === "id") continue;
        const safeKey = rik.replace(/[()]/g, "").replace(" as ", " ").replace(/\s+/g, "_");
        item[safeKey] = rawItem[rik];
      }

      // Make sure it has an id field.
      if (!("id" in item) || item.id === undefined || ids.includes(item.id)) {
        item.id = item.airtable_id.toString();
      }
      // Keep track of ids to spot duplicates
      ids.push(item.id);

      const imageFields = (Object.keys(item).filter(k => {
        const e = item[k] as unknown[];
        if (e && e[0] && !!Object.getOwnPropertyDescriptor(e[0], "type")) {
          const typedE = e[0] as {[key: string] : string};
          if (typedE.type.includes("image")) {
            return true;
          }
        }
      }));

      for (const imageField of imageFields) {
        const {url, filename} = rawItem[imageField][0];
        // import image
        const imageUploadResponse = await client.request(importFile(url, {
          title: filename
        })).catch(err => console.error(`Could not import image ${filename}`, err)) as {id: string};

        // Create relationships field if needed
        const rel = await client.request(readRelation(collName, imageField)).catch(() => {});
        if (!rel) {
          await client.request(createRelation({
            collection: collName,
            field: imageField,
            related_collection: "directus_files",
            meta: {
              sort_field: null
            },
            schema: {
              table: collName,
              column: imageField,
              foreign_key_table: "directus_files",
              foreign_key_column: "id",
              on_update: "NO ACTION",
              on_delete: "SET NULL"
            },
          })).catch(err => console.error(`Could note create image relation for ${imageField} in ${collName}`, err));
        }
        
        // Adjust image item:
        if (imageUploadResponse.id) {
          item[imageField] = imageUploadResponse.id;
        } else {
          console.warn(`Uploaded ${filename}, but could not assign to image field of item ${item.id}.`);
        }
      }

      // Keep track of ids and collection for relationships.
      relationshipTargets[item.airtable_id] = collName;

      // Keep track of referring ids
      const collRelFields = Object.keys(relationshipFields[collName]);
      for (const k in item) {
        if (collRelFields.includes(k)) {
          const refVal = Array.isArray(item[k]) ? item[k] as string[] : [item[k] as string];
          const relItem: {id: string, ref: string[], [key: string]: unknown} = {
            id: item.id,
            ref: refVal
          };
          relItem[k] = item[k];
          relationshipFields[collName][k].all = relationshipFields[collName][k].all.concat(refVal);
          relationshipFields[collName][k].items.push(relItem);
        }
      }

      await client.request(createItem(collName, item)).catch(async err => {
        if (err.errors[0].extensions.code === "RECORD_NOT_UNIQUE") {
          console.error(`Attempting to update ${item.airtable_id}`);
          await client.request(updateItem(collName, item.airtable_id, item)).catch(err => 
            console.error(`Could not create item ${item.airtable_id}`, err));
        } else {
          console.error(`Could not create item ${item.airtable_id}`, err);
        }
      });
    }
  }

  // Set relationships
  console.info("🔄 Creating relationships.");

  // relationshiFields: all fields that express relationships, organized by collection
  for (const coll in relationshipFields) {
    for (const field in relationshipFields[coll]) {

      //Set up fields and relationships
      for (const id of relationshipFields[coll][field].all) {

        const relatedColl = relationshipTargets[id];

        if (!relatedColl) {
          console.info(`Could not find referenced id ${id} from field ${field} in ${coll}`);
          continue;
        }

        console.info(`Processing ${id} from field ${field} in ${coll}`);

        // Create collection if needed
        const jointColl = `${coll}_${relatedColl}`;
        const collection = await client.request(readCollection(jointColl))
          .catch(() => console.error(`Could not retrieve collection ${jointColl}, will create it.`));

        if (!collection) {
          await client.request(
            createCollection({
              collection: jointColl,
              meta: {
                hidden: true,
                icon: "import_export"
              },
              schema: { 
                schema: jointColl,
                name: jointColl,
                comment: jointColl,
              },
              fields: [
                {
                  field: "id",
                  type: "integer",
                  schema: {
                    "has_auto_increment": true
                  },
                  meta: {
                    "hidden": true
                  }
                }
              ]
            })
          ).catch(err => console.error(`Error creating collection ${jointColl}`, err));
          console.info(`Created ${jointColl}`);
        }

        // Create fields in joint coll
        const collField = await client.request(readField(jointColl, `${coll}_id`)).catch(() => {});

        if (!collField) {
          await client.request(
            createField(jointColl, {
              field: `${coll}_id`,
              type: "string",
              schema: {},
              meta: {
                hidden: true
              }
            })
          ).catch(err => console.error(`Could not create field ${coll}_id on ${jointColl}`, err));
          console.info(`Created field ${coll}_id on ${jointColl}`);
        }

        const relatedCollField = await client.request(readField(jointColl, `${relatedColl}_id`)).catch(() => {});

        if (!relatedCollField){
          await client.request(
            createField(jointColl, {
              field: `${relatedColl}_id`,
              type: "integer",
              schema: {},
              meta: {
                hidden: true
              }
            })
          ).catch(err => console.error(`Could not create field ${relatedColl}_id on ${jointColl}`, err));
          console.info(`Created field ${relatedColl}_id on ${jointColl}`);
        }


        // create relationships
        const relateCollRel = await client.request(readRelation(jointColl, `${relatedColl}_id`)).catch(() => {});

        if (!relateCollRel) {
          await client.request(createRelation({
            "collection": jointColl,
            "field": `${relatedColl}_id`,
            "related_collection": relatedColl,
            "meta": {
              "one_field": null,
              "sort_field": null,
              "one_deselect_action": "nullify",
              "junction_field": `${coll}_id`
            },
            "schema": {
              "on_delete": "SET NULL"
            }
          })).catch(async err => console.error(`Error creating relationship ${relatedColl}_id to ${coll}_id on ${jointColl}`, err));
          console.info(`Created relationship ${relatedColl}_id to ${coll}_id on ${jointColl}`);
        }

        const collRel = await client.request(readRelation(jointColl, `${coll}_id`)).catch(() => {});

        if (!collRel) {

          // CREATE THE FIELD AS ALIAS
          const aliasField = await client.request(readField(coll, field)).catch(() => {});

          if (!aliasField) {
            await client.request(createField(coll, {
              field,
              type: "alias",
              meta: {
                special: [
                  "m2m"
                ],
                interface: "list-m2m",
                options: {
                  layout: "list"
                },
              }
            })).catch((err) => console.error(`Could not create field ${field} on ${coll}`, err));
            console.info(`Created field ${field} on ${coll}`);
          }

          await client.request(createRelation({
            "collection": jointColl,
            "field": `${coll}_id`,
            "related_collection": coll,
            "meta": {
              "one_field": field,  // THE FIELD FROM AIRTABLE (NOW AN ALIAS)
              "sort_field": null,
              "one_deselect_action": "nullify",
              "junction_field": `${relatedColl}_id`
            },
            "schema": {
              "on_delete": "SET NULL"
            }
          })).catch(async err => console.error(`Error creating relationship ${coll}_id to ${relatedColl}_id on ${jointColl}`, err));
          console.info(`Created relationship ${coll}_id to ${relatedColl}_id on ${jointColl}`);
        }
      }

      // Populate relationship fields
      console.info(`Populating relationship field ${field} in ${coll}.`);
      for (const item of relationshipFields[coll][field].items) {
        
        // Find referenced IDs
        for (const ref of item.ref as string[]) {
          const targetColl = relationshipTargets[ref];
          if (!targetColl) continue;

          const matchedItems: Record<string, unknown>[] | void = await client.request(readItems(targetColl, {
            filter: {
              airtable_id: {
                _eq: ref,
              },
            }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as Query<any, any>)).catch(err => console.error(err));

          if (!matchedItems || !matchedItems[0]) continue;

          const updatedItem: {[key: string]: unknown} = {};
          updatedItem[field] = {
            create: [
              {
                [`${coll}_id`]: item.id,
                [`${targetColl}_id`]: {
                  "id": matchedItems[0].id
                }
              }
            ],
            "update": [],
            "delete": []
          };

          await client.request(updateItem(coll, item.id, updatedItem)).catch(err => 
            console.error(`Could not update item ${item.id} with relationship`, err));
        }
      }

    }
  }
  process.exit(0);
};

const program = new Command();

program
  .version(process.env.npm_package_version || "0.0.0")
  .description("mith-directus: Populate a directus instance from MITH AirTable YAML exports")
  .argument("<input-folder>")
  .option("-d, --directus <URL>", "URL to directus instance", "http://0.0.0.0:8055")
  .option("-u, --user <username>", "directus user name")
  .option("-p, --password <password>", "directus password")
  .option("-r, --replace", "replace existing collections with new data instead of merging (NB removes all tables!)", false)
  .parse(process.argv);

const opts = program.opts();
populate(program.args[0], opts as ProgramOptions);
