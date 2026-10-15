import { build as bundle } from "esbuild";
import { build } from "vite";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import config from "./vite.config.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const output = fileURLToPath(new URL("../../outputs/cloudbase", import.meta.url));
await build(config);
await mkdir(`${output}/functions/squad-api`, { recursive: true });
await rm(`${output}/functions/squad-api/index.cjs`, { force: true });
await bundle({
  entryPoints: [`${here}/handler.ts`],
  outfile: `${output}/functions/squad-api/index.js`,
  platform: "node", target: "node20", format: "cjs", bundle: true,
  alias: { "@/lib/room-store": `${here}/room-store.ts`, "@": root },
});
await writeFile(`${output}/functions/squad-api/package.json`, JSON.stringify({ main: "index.js" }));
console.log(`CloudBase artifacts ready: ${output}`);
