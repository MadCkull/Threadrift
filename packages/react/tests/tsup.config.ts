import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["tests/navigation.test.ts", "tests/persistence.test.ts"],
  format: ["cjs"],
  outDir: ".turbo/tests",
  // node:test has no unprefixed alias; preserve the built-in import.
  removeNodeProtocol: false,
});
