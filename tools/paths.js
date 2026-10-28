const path = require("path");

const PROJECT = path.resolve(__dirname, "..");
const WEB = path.join(PROJECT, "web");
const COLLECTIONS_DIR = path.join(PROJECT, "collections");
const COLLECTIONS_URL = "collections";

module.exports = { PROJECT, WEB, COLLECTIONS_DIR, COLLECTIONS_URL };
