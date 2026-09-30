// Runs before dev/build. Fetches the background-removal model (pinned by SHA-256) and copies the
// ONNX Runtime WebAssembly file into public/, so everything is served from our own origin.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx";
const MODEL_SHA256 = "75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb";
const PART_SIZE = 20 * 1024 * 1024; // some static hosts cap files at 25 MB
const outDir = "public/models";
const manifestPath = `${outDir}/silueta.json`;

// Guardrail: refuse to build a site that talks to any Supabase project other than KlickList's own.
const guard = JSON.parse(readFileSync("klicklist.config.json", "utf8"));
const url = process.env.VITE_SUPABASE_URL;
if (url && process.env.CI && new URL(url).hostname !== `${guard.supabaseProjectRef}.supabase.co`) {
  throw new Error(`VITE_SUPABASE_URL points at ${new URL(url).hostname}, not KlickList's project ${guard.supabaseProjectRef}. Refusing to build.`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync("public/ort", { recursive: true });
copyFileSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "public/ort/ort-wasm-simd-threaded.wasm");
// Free barcode reader for phones without a built-in one (iPhone); served from our own site.
mkdirSync("public/zxing", { recursive: true });
copyFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", "public/zxing/zxing_reader.wasm");

const done = existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, "utf8")).sha256 === MODEL_SHA256;
if (!done) {
  console.log("Downloading background-removal model (44 MB, one time)…");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== MODEL_SHA256) throw new Error(`Model checksum mismatch (${sha}) - refusing to use it`);
  const parts = [];
  for (let i = 0; i * PART_SIZE < buf.length; i++) {
    const name = `silueta.${i}.bin`;
    writeFileSync(`${outDir}/${name}`, buf.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
    parts.push(name);
  }
  writeFileSync(manifestPath, JSON.stringify({ sha256: MODEL_SHA256, size: buf.length, parts }));
  console.log(`Model ready in ${parts.length} parts.`);
}
