const lib = require("./lib");

main();

async function main() {
  const client = new lib.BugzillaClient();

  // const res = await client.getBugById([ 144233, 1245232 ]);
  // const res = await client.getBugHistory([ 144233, 1245232 ]);
  // const res = await client.searchBugs({ limit: 15, creation_time: new Date("2020-10-01") });
  const res = await client.getProduct("Firefox");

  console.log(res);
}
