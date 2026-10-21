// Metro, widened by exactly the two folders the client shares with the web app.
//
// `@orbit-types/*` and `@orbit-messages/*` (tsconfig.json) point outside this project, at the web
// app's pure type modules and its message catalogue. Metro bundles only what it watches, so those
// folders are added here and nothing else is: a module there that reached for a web dependency would
// fail to resolve, which is the point — they are shared because they need nothing.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [
  path.resolve(__dirname, "../src/types"),
  path.resolve(__dirname, "../src/messages"),
];

module.exports = config;
