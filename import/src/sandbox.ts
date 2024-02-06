import Strapi, { StrapiAuthenticationResponse, StrapiResponse } from "strapi-sdk-js";
import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
    

const strapi = new Strapi({
  url: "http://localhost:1337"
});

async function test() {
  // console.log(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const data = await strapi.login({ identifier: "apiuser@mith.us", password: "changeme"}).catch((err) => {console.log(err);});

  // const realTest = {
  //   "airtable_id":"rec03bbHKDTpK6g5d",
  //   "airtable_createdTime":"2020-11-12T22:57:51.000Z",
  //   "description":"Participants and instructors will gather on the campus of the Indiana University-Purdue University Indianapolis in Indianapolis, Indiana for our our 7th year of HILT.\n",
  //   "end_date":"2019-06-07T04:00:00.000Z",
  //   "event_title":"HILT 2019",
  //   "event_type":["Training Institute"],
  //   "linked_research_item_slug":["humanities-intensive-learning-teaching"],
  //   "linked_research_item_title":["Humanities Intensive Learning + Teaching"],
  //   "location":"Indiana University-Purdue University Indianapolis (IUPUI)",
  //   "mith_url":"https://mith.umd.edu/digital-dialogues/hilt-2019",
  //   "slug":"hilt-2019",
  //   "start_date":"2019-06-03T04:00:00.000Z",
  //   "year":2019,
  //   "image": 0
  // };

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

  // const newItem = await strapi.create("events", realTest).catch((err) => {console.log(err);});

  // const newItemId = (newItem as StrapiResponse<{id: string}>).data.id;
  
  // console.log(newItemId);
  await strapi.update("events", , {
    "topics": [56]
  }).catch((err) => {console.log(err);});
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