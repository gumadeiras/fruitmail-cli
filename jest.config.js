const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  // Source files import siblings with a `.js` suffix for Node ESM-style resolution; map them back to the TypeScript sources.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    ...tsJestTransformCfg,
  },
};