import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["tests/navigation-geometry.test.ts", "tests/camera.test.ts"],
  format: ["cjs"],
  outDir: ".turbo/tests",
  removeNodeProtocol: false,
});
