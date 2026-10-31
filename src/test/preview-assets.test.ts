import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("ships the WebAssembly filename requested by the browser sql.js loader", () => {
  const loader = readFileSync(resolve("node_modules/sql.js/dist/sql-wasm-browser.js"), "utf8");
  const name = loader.match(/locateFile\("([^"]+)"/)?.[1];
  expect(name).toBe("sql-wasm-browser.wasm");
  if (!name) throw new Error("Missing loader filename");
  const binary = readFileSync(resolve("public/wasm", name));
  expect(Array.from(binary.subarray(0, 4))).toEqual([0, 97, 115, 109]);
});