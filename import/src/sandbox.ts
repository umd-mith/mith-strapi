import Strapi, { StrapiAuthenticationResponse, StrapiResponse } from "strapi-sdk-js";
import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
    

const strapi = new Strapi({
  url: "http://localhost:1337"
});

async function test() {
  // console.log(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const data = await strapi.login({ identifier: "", password: ""}).catch((err) => {console.log(err);});

  const { user, jwt } = data as StrapiAuthenticationResponse

  const realTest = {
    "airtable_id":"DELETEME",
  };

  strapi.axios.defaults.headers.common["Authorization"] = `Bearer ${jwt}`
  await strapi.findOne("events", 1).catch(err => console.log(err))
  await strapi.create("events", realTest).catch((err) => {console.log(err);});

  // // find image:
  // const media = await strapi.find("upload/files", {
  //   filters: {
  //     name: {
  //       $eq: "event_hilt.png"
  //     }
  //   }
  // }).catch((err) => {console.log(err);});

  // if (media) {
  //   realTest.image = parseInt((media as unknown as {id: string}[])[0].id);
  // }

  // await strapi.findOne('events', 1).catch((err) => {console.log(err);});
  

  // const newItem = await strapi.create("events", realTest).catch((err) => {console.log(err);});

  // const newItemId = (newItem as StrapiResponse<{id: string}>).data.id;
  
  // console.log(newItemId);
  // await strapi.update("events", , {
  //   "topics": [56]
  // }).catch((err) => {console.log(err);});
  // event 309 { speakers: [ 313, 384 ] }

  // console.log(await strapi.setToken((data as StrapiAuthenticationResponse).jwt));
  // const jwt = (data as StrapiAuthenticationResponse).jwt;
  // await strapi.setToken(jwt);

  // type Uffa = {id: string};
  // const obj1 = await strapi.create("test1s", { // API endpoints use the plural!
  //   "Title": "The Fork",
  // }).catch((err) => {console.log(err);});

  // const obj2 = await strapi.create("test2s", {
  //   "Title": "The Spoon",
  // }).catch((err) => {console.log(err);});

  // // console.log((obj1 as StrapiResponse<Uffa>).data.id, (obj2 as StrapiResponse<Uffa>).data.id);

  // await strapi.update("test1s", (obj1 as StrapiResponse<Uffa>).data.id, {
  //   test_2s: (obj2 as StrapiResponse<Uffa>).data.id
  // });


  // const response = await axios
  //   .post("http://localhost:1337/api/auth/local", {
  //     identifier: "apiuser@mith.us",
  //     password: "changeme",
  //   });

  // const {user, jwt} = response.data;

  // axios.post("http://localhost:1337/api/test1", {
  //   data: {
  //     title: "The Fork",
  //     test_2s: {
  //       connect: [], disconnect: []
  //     }
  //   }
  // }, {
  //   headers: {
  //     Authorization:
  //       `Bearer ${jwt}`,
  //   },
  // }).catch(err => console.log(err));

}

test();