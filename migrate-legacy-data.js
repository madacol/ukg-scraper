import path from "path";
import { fileURLToPath } from "url";
import { migrateLegacyData } from "./day-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

/**
 * @param {Record<string, unknown>} result
 * @returns {string}
 */
function formatResult(result) {
  return JSON.stringify(result, null, 2);
}

function main() {
  const result = migrateLegacyData(DATA_DIR);
  console.log(formatResult(result));
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main();
}
