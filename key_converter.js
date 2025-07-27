const fs = require("fs");
const encoded = fs.readFileSync("firebase_secret_key.json", "utf8");

const base64Key = Buffer.from(encoded).toString("base64");
