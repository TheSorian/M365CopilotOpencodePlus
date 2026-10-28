import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const setup = path.dirname(fileURLToPath(import.meta.url));

export async function generateToWorkspace(input, directory, signal, generate) {
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw new Error("Missing image description.");
  }
  const workspace = await fs.realpath(directory);
  const relative = input.path || "generated-images/imagen.png";
  if (typeof relative !== "string" || path.isAbsolute(relative)) {
    throw new Error("The path must be relative to the workspace.");
  }
  const target = path.resolve(workspace, relative);
  const inside = value => {
    const rel = path.relative(workspace, value);
    return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
  };
  if (!inside(target) || path.extname(target).toLowerCase() !== ".png") {
    throw new Error("Use a .png path inside the workspace.");
  }
  // Check every existing ancestor before creating directories: do not follow
  // a workspace symlink into another project or the user's home.
  const parent = path.dirname(target);
  let current = workspace;
  for (const part of path.relative(workspace, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("The target folder contains a symlink or is not a directory.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(current);
    }
  }
  // Reserve the filename before spending image-generation quota.
  const handle = await fs.open(target, "wx", 0o600);
  let saved = false;
  try {
    if (!generate) {
      // This file is location-agnostic: it may live in the proxy repo
      // (plugins/opencode/, next to packages/core) or be copied by an installer
      // into a setup home (next to ./m365-copilot-proxy/). Try each layout, or
      // point M365_CORE_PATH at the built core directly.
      const candidates = [
        process.env.M365_CORE_PATH,
        path.resolve(setup, "../../packages/core/dist/index.mjs"),
        path.resolve(setup, "m365-copilot-proxy/packages/core/dist/index.mjs"),
        path.resolve(setup, "../m365-copilot-proxy/packages/core/dist/index.mjs"),
      ].filter(Boolean);
      const corePath = candidates.find((p) => existsSync(p));
      if (!corePath) {
        throw new Error(
          "packages/core/dist/index.mjs not found (build the proxy or set M365_CORE_PATH).",
        );
      }
      // The auth data (secrets.json, msal-cache.json…) sits in the setup home:
      // the installer's layout, or the repo checkout's parent.
      const dataDir = process.env.M365_SETUP_DIR ??
        [setup, path.resolve(setup, "..", "..", ".."), path.resolve(setup, "..")]
          .find((dir) => existsSync(path.join(dir, "secrets.json"))) ?? setup;
      process.env.M365_SECRETS_FILE ??= path.join(dataDir, "secrets.json");
      process.env.M365_CACHE_FILE ??= path.join(dataDir, "msal-cache.json");
      process.env.M365_BROWSER_PROFILE ??= path.join(dataDir, "browser-profile");
      process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(dataDir, "ms-playwright");
      const core = await import(pathToFileURL(corePath).href);
      generate = core.generateImage;
    }
    const images = await generate(input.prompt, {
      orientation: input.orientation || "square",
      signal,
    });
    if (!images.length) throw new Error("The service returned no images.");
    const image = images[0];
    const bytes = Buffer.from(image.data);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(png)) {
      throw new Error("The service did not return a valid PNG; refusing to save with an incorrect extension.");
    }
    await handle.writeFile(bytes);
    saved = true;
    return {
      path: path.relative(workspace, target),
      bytes: bytes.length,
      mime: "image/png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      additionalImages: Math.max(0, images.length - 1),
    };
  } finally {
    await handle.close();
    if (!saved) await fs.unlink(target).catch(() => {});
  }
}
