// Shared business rules come straight from the website (../src/lib): pricing, timing, slots, pay on delivery.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../src/lib")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
