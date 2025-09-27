const fs = require("fs");
const encoded = fs.readFileSync("serviceAccountKey.json", "utf8");

const base64Key = Buffer.from(encoded).toString("base64");
console.log(base64Key)