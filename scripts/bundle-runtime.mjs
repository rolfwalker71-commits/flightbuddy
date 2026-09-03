#!/usr/bin/env node
/**
 * Bundle worker + prisma seed for the production image.
 * Keeps @prisma/client external (native engines live in node_modules).
 */
import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  external: ["@prisma/client", ".prisma/client"],
  alias: {
    "@": root,
  },
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "worker/index.ts")],
  outfile: path.join(root, "dist/worker.cjs"),
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "prisma/seed.ts")],
  outfile: path.join(root, "dist/seed.cjs"),
});
