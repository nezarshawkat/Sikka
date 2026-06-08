import { runGtfsImport } from "../routes/seedGtfs";

const apply = process.argv.includes("--apply");
runGtfsImport(!apply)
  .then((s) => {
    console.log(JSON.stringify(s, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
