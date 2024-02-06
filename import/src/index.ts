import { Command } from "commander";
import type { OptionValues } from "commander";
import * as fs from "fs";
const pfs = fs.promises;
import * as path from "path";
import YAML from "yaml";
import dotenv from "dotenv";
dotenv.config();
import Strapi, { StrapiResponse } from "strapi-sdk-js";

type FieldType = "integer" | "float" | "string" | "datetime" | "uid" | "text" | "relation" | "media" |
  "json" | "boolean" | "enumeration" | "customField"  | "plugin::multi-select.multi-select" | "formula" | "lookup" | "rollup";

interface ColField {
  [key: string]: {
    type: FieldType,
    enum?: string[]
    options?: string[]
    customField?: string
  }
}

interface Relationships {
  [key: string]: {
    all: string[]
    items: {
      id: string,
      [key: string]: unknown
    }[],
    reverse: {
      coll: string
      field: string
    }
  }
}

interface FieldAcc {
  failed: string[]
  succeeded: string[]
  fields: ColField[]
  relationships: Relationships
}

interface ProgramOptions extends OptionValues {
  strapi: string
  create: boolean
  populate: boolean
}

interface ApiInfo {singular:string, plural:string}

interface RelationSchema {
  [key: string]: Relation
}

interface Relation {
  "type": "relation",
  "relation": "manyToMany",
  "target"?: string
  "mappedBy"?: string // TO COLLECTION SCHEMA WITH THE ATTRIBUTE THAT DOES THE POINTING, E.G. person.event_as_speaker -> event.?
  "inversedBy"?: string // INVERSE OF ABOVE
}

const controllerTpl = (name: string) => {
  return `'use strict';

/**
 * ${name} controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::${name}.${name}');
`;
};

const routeTpl = (name: string) => {
  return `'use strict';

/**
 * ${name} router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::${name}.${name}');
  
`;
};

const serviceTpl = (name: string) => {
  return `'use strict';

/**
 * ${name} service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::${name}.${name}');    
`;
};

/* The `extractYmlFields` function takes in the name of a collection and an array of YAML
objects. It iterates over each object in the array and extracts the fields based on the data
provided. */
const extractYmlFields: (coll: string, yml: {[key: string]: unknown}[], mapping: {[key: string]: {
  [key: string]: {
    type: FieldType,
    values?: string[],
    linkedField?: string,
    field?: string
    convert?: boolean
  }
}}) => [ColField[], Relationships] = (coll, yml, mapping) => {
  // Determine fields based on the data provided (as list of objects) 
  const data = yml.reduce((acc: FieldAcc, entry) => {
    for (const k in entry) {
      const safeKey = k.replace(/[()]/g, "").replace(/\s+/g, "_");
      if (acc.failed.includes(k) || acc.succeeded.includes(k)) continue;
      if (k === "id") continue;
      const field: ColField = {};
      field[safeKey] = {
        type: "string"
      };

      // Lookup type in mapping and only infer if it's not provided.
      const mappedField = mapping[coll][safeKey];

      
      if (mappedField !== undefined) {
        if (mappedField.type === "enumeration") {
          field[safeKey].type = mappedField.type;
          field[safeKey].enum = mappedField.values;
          acc.succeeded.push(k);
          acc.fields.push(field);
          continue;
        }
        
        if (mappedField.type === "plugin::multi-select.multi-select") {
          field[safeKey].type = "customField";
          field[safeKey].options = mappedField.values;
          field[safeKey].customField = "plugin::multi-select.multi-select";
          acc.succeeded.push(k);
          acc.fields.push(field);
          continue;
        }

        if (mappedField.type === "formula" || mappedField.type === "lookup" || mappedField.type === "rollup") {
          // no-op for now
        } else {
          field[safeKey].type = mappedField.type;
          acc.succeeded.push(k);
          acc.fields.push(field);
          continue;
        }
      }

      switch(typeof entry[k]) {
      case "boolean":
        field[safeKey].type = "boolean";
        break;
      case "number":
        field[safeKey].type = Number.isInteger(entry[k]) ? "integer" : "float";
        break;
      case "object":
        if (Array.isArray(entry[k])) {
          // If it's an array of strings, this may be O2M field, otherwise use json.
          const e = entry[k] as unknown[];
          if (e.length === 0 || typeof e[0] === "string") {
            if ((e[0] as string).match(/^rec/)) {
              // keep track of this field so that relationships can be determined later
              acc.relationships[safeKey]= {
                all: [],
                items: [],
                reverse: {
                  coll: "",
                  field: ""
                }
              };
              continue; // do not record this field as it needs to be handled together with relationships
            } else {
              field[safeKey].type = "json";
            }
            break;
          } else if (e[0] && !!Object.getOwnPropertyDescriptor(e[0], "type")) {
            // But if it's an array of objects, try to determine if it's a media field
            // NB only the first attachment will be migrated.
            const typedE = e[0] as {[key: string] : string};
            if (Object.keys(typedE).includes("filename")) {
              field[safeKey] = Object.assign(field[safeKey], {
                type: "media",
                "allowedTypes": [
                  "images",
                  "files",
                  "videos",
                  "audios"
                ],
                "multiple": false
              });
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
          field[safeKey].type = "text";
        }
        // check if it's a date (this triggers only if the string starts with a digit to avoid false positives)
        else if ((entry[k] as string).match(/^\d/) && !isNaN(new Date(entry[k] as string).getTime())) {
          field[safeKey].type = "datetime";
        }
        break;
      default:
        field[safeKey].type = "string";
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
  
  return [data.fields, data.relationships];
};

let strapiInstance: null | Strapi = null;

const getStrapi = async () => {
  if (!strapiInstance) {
    strapiInstance = new Strapi({
      url: opts.strapi
    });
  
    // login to strapi
    await strapiInstance.login({ identifier: process.env.ADMIN_EMAIL || "", password: process.env.ADMIN_PASSWORD || ""})
      .catch((err) => {console.log(`could not connect with ${process.env.ADMIN_EMAIL} ${process.env.ADMIN_PASSWORD }`); console.log(err); process.exit(1);});
  }

  return strapiInstance;
};

const populate = async (dir: string, opts: ProgramOptions) => {

  if (opts.create && opts.populate) {
    console.error("Cannot create and populate at the same time; run in two steps.");
    process.exit(1);
  }

  // Create by default
  if (!opts.create && !opts.populate) {
    opts.create = true;
  }

  const supplementaryMapping = JSON.parse(await pfs.readFile(path.join(__dirname, "supplementaryMapping.json"), "utf-8"));

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

  const apiNames: {[key: string]: ApiInfo} = {
    "People": {
      singular: "person",
      plural: "people"
    },
    "Identities": {
      singular: "identity",
      plural: "identities"
    },
    "Partners_Sponsors": {
      singular: "partner-sponsor",
      plural: "partners-sponsors"
    },
    "Research": {
      singular: "research-item",
      plural: "research-items"
    },
    "Taxonomy": {
      singular: "taxonomy-value",
      plural: "taxonomy-values"
    }
  };

  // Map airtable ids and strapi ids on creation
  const idPairs: {airtable: string, strapi: string}[] = [];
  
  // PART 1: FIELDS
  for (const file of files) {
    // get file content and parse as YAML
    const fileData: string = (await pfs.readFile(path.join(inputDir, file))).toString();
    const yData = YAML.parse(fileData);

    const collName = path.parse(file).name;
    
    if (!Object.keys(apiNames).includes(collName)) {
      apiNames[collName] = {
        singular: collName.toLowerCase().slice(0, -1),
        plural: collName.toLowerCase()
      };
    }

    // Create api if needed
    const apiInfo = apiNames[collName];
    const apiName = apiInfo.singular;
    const apiPath = path.join(__dirname, "../../src/api", apiName);

    const [fields, relationships] = extractYmlFields(apiInfo.plural, yData, supplementaryMapping);
    // store all related fields for this collection
    relationshipFields[apiName] = relationships;

    if (opts.create) {
      try {
        // Check if the directory exists
        await pfs.access(apiPath);
        console.log(`Skipping ${apiName}`);
        continue;
      } catch (error) {
        // Directory doesn't exist, so create it
        await pfs.mkdir(`${apiPath}/content-types/${apiName}`, { recursive: true });
        await pfs.mkdir(`${apiPath}/controllers`, { recursive: true });
        await pfs.writeFile(`${apiPath}/controllers/${apiName}.js`, controllerTpl(apiName));
        await pfs.mkdir(`${apiPath}/routes`, { recursive: true });
        await pfs.writeFile(`${apiPath}/routes/${apiName}.js`, routeTpl(apiName));
        await pfs.mkdir(`${apiPath}/services`, { recursive: true });
        await pfs.writeFile(`${apiPath}/services/${apiName}.js`, serviceTpl(apiName));
        console.log(`🏗 Directories for ${apiName} created successfully!`);
      } 

      // Build schema
      const schema = {
        "kind": "collectionType",
        "collectionName": apiInfo.plural,
        "info": {
          "singularName": apiInfo.singular,
          "pluralName": apiInfo.plural,
          "displayName": apiInfo.plural
        },
        "options": {
          "draftAndPublish": true
        },
        "pluginOptions": {},
        "attributes": {}
      };

      schema.attributes = Object.assign(schema.attributes, ...fields);
      await pfs.writeFile(`${apiPath}/content-types/${apiName}/schema.json`, JSON.stringify(schema, null, 2));
    }

    // Search through the data to establish parallel relationship fields
    
    for (const rawItem of yData) {
      const item: {airtable_id: string, [key: string]: unknown} = {
        airtable_id: rawItem.airtable_id || rawItem.id || "",
      };
      // Only get identified fields
      for (const rik in rawItem) {
        if (rik === "airtable_id") continue;
        const safeKey = rik.replace(/[()]/g, "").replace(/\s+/g, "_");

        // manage media
        if (rawItem[rik][0] && rawItem[rik][0].filename) {
          // find media id:
          if (opts.populate) {
            const strapi = await getStrapi();

            const media = await strapi.find("upload/files", {
              filters: {
                name: {
                  $eq: rawItem[rik][0].filename
                }
              }
            }).catch((err: Error) => {console.log("Error querying media"); console.log(err);});
  
            if (media) {
              item[safeKey] = parseInt((media as unknown as {id: string}[])[0].id);
            }
          }
          continue;
        }

        const thisField = fields.filter(f => Object.keys(f).includes(safeKey))[0];
        if (thisField) {
          // normalize dates
          if (thisField[safeKey].type.toString() === "datetime") {
            item[safeKey] = new Date(rawItem[rik] as string).toISOString();
          } else {
            // store value
            item[safeKey] = rawItem[rik];
          }
        }

        // Keep track of ids and collection for relationships.
        // e.g. relationshipTargets.PERSON_ID = PEOPLE
        relationshipTargets[item.airtable_id] = apiName;

        // Get all the fields for this collection that are a relationship
        const collRelFields = Object.keys(relationshipFields[apiName]);
        
        if (collRelFields.includes(safeKey)) {
          // save the references as an array (refVal)
          const refVal = Array.isArray(rawItem[rik]) ? rawItem[rik] as string[] : [rawItem[rik] as string];
          // and save information about the item that does the referencing (ie the current item)
          const relItem: {id: string, ref: string[], [key: string]: string[] | string} = {
            id: item.airtable_id,
            ref: refVal
          };
          // also save a full copy of the referencing item
          relItem[safeKey] = rawItem[rik];
          // add all the referenced ids (refVal) to the relationship field
          relationshipFields[apiName][safeKey].all = relationshipFields[apiName][safeKey].all.concat(refVal);
          relationshipFields[apiName][safeKey].items.push(relItem);
        }
      }

      if (opts.populate) {
        // Use the API to populate the field
        // console.log(`Attempting to write to collection: ${apiInfo.plural}, item ${JSON.stringify(item)}`);
        const strapi = await getStrapi();
        const entry = await strapi.create(apiInfo.plural, item).catch((err) => {
          console.log(err);
          console.log(`Attempted to write to collection: ${apiInfo.plural}, item ${JSON.stringify(item)}`);
        });
        if (!entry) {
          process.exit(1);
        }
        const entryData = (entry as StrapiResponse<{id: string}>).data;
  
        // Store the returned strapi id with the original airtable_id to find relationships later.
        idPairs.push({
          airtable: item.airtable_id,
          strapi: entryData.id
        });
      }
    }
  }

  // PART 2: RELATIONSHIPS

  if (opts.create) {
    console.info("🔄 Creating relationship fields.");
    // Now use the relationship objects to modify schema files to establish relationships (we default to many to many).
  
    const schemaAdditions: {[key: string]: RelationSchema} = {};
  
    // Loop through collections in relationshipFields
    for (const coll in relationshipFields) {
      // loop through fields that express a relationship in this collection
      for (const field in relationshipFields[coll]) {
        // field will be the name of a new relationship
        // So we need to add this to the schema for coll
        const relAtt: Relation = {
          "type": "relation",
          "relation": "manyToMany"
        };
  
        // look through the references and see if they match anything in relationshipTargets
        // if they do, then we add a target to that collection
        // and we make up an inverse field name, e.g. target_of_COLL_FIELD
        for (const target of relationshipFields[coll][field].all) {
          if (Object.keys(relationshipTargets).includes(target)) {
            const targetApiName = relationshipTargets[target];
            const targName = `target_of_${coll.replace("-", "")}_${field}`;
            relAtt.target = `api::${targetApiName}.${targetApiName}`;
            relAtt.inversedBy = targName;
  
            // add info to the targeted collection
            const targAtt: Relation = {
              "type": "relation",
              "relation": "manyToMany",
              "target": `api::${coll}.${coll}`,
              mappedBy: field
            };
  
            if (!schemaAdditions[targetApiName]) {
              schemaAdditions[targetApiName] = {};
            }
  
            schemaAdditions[targetApiName][targName] = targAtt;
          }
        }
  
        // If a target could not be found, skip the relationship. This may happen for references to Audit Tracking, which is not backed up.
        if (relAtt.target) {
          if (!schemaAdditions[coll]) {
            schemaAdditions[coll] = {};
          }
    
          schemaAdditions[coll][field] = relAtt;
        }
  
      }
    }

    // Add schema additions to schema files
    for (const coll in schemaAdditions) {
      const JSONpath = `${path.join(__dirname, "../../src/api", coll)}/content-types/${coll}/schema.json`;
      const schemaString = await pfs.readFile(JSONpath, "utf-8");
      const schema = JSON.parse(schemaString);
      schema.attributes = Object.assign(schema.attributes, schemaAdditions[coll]);
      await pfs.writeFile(JSONpath, JSON.stringify(schema, null, 2));
    }

  } else if (opts.populate) {
    console.info("🔄 Populating relationship fields.");
    const strapi = await getStrapi();
    // Loop over relationships to populate the records.
    // Loop through collections in relationshipFields
    for (const coll in relationshipFields) {

      const collName = Object.keys(apiNames).filter(name => {
        return apiNames[name].singular === coll;
      })[0];

      const apiName = collName ? apiNames[collName].plural : coll + "s";

      // loop through fields that express a relationship in this collection
      for (const field in relationshipFields[coll]) {

        // look through stored items that express relationships
        for (const referencingItem of relationshipFields[coll][field].items) {
          const ri = referencingItem as {[key:string]: string[]};
          const itemStrapiId = idPairs.filter(ip => ip.airtable === referencingItem.id)[0]?.strapi;
          
          const targets = ri[field].filter(t => Object.keys(relationshipTargets).includes(t)).map(t => (
            idPairs.filter(ip => ip.airtable === t)[0]?.strapi
          ));
          const toUpdate: {[key: string]: unknown} = {};
          toUpdate[field] = targets;
          await strapi.update(apiName, itemStrapiId, toUpdate).catch(err => {console.log(`Error updating relationship: ${apiName} ${itemStrapiId} ${JSON.stringify(toUpdate)}`); console.log(err)});
        }
      }
    }
  }

  process.exit(0);
};


const program = new Command();

program
  .version(process.env.npm_package_version || "0.0.0")
  .description("mith-strapi-populate: Create or Populate a Strapi instance from MITH AirTable YAML exports")
  .argument("<input-folder>")
  .option("-s, --strapi <URL>", "URL to Strapi instance", "http://localhost:1337")
  .option("-c, --create", "Create instances (default behavior)", false)
  .option("-p, --populate", "Populate", false)
  .parse(process.argv);

const opts = program.opts();
populate(program.args[0], opts as ProgramOptions);

