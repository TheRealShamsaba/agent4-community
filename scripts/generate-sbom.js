import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(process.argv[2] || path.join(root, ".artifacts", "sbom"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

await mkdir(outputDirectory, { recursive: true });

for (const project of [
  { name: "server", directory: root },
  { name: "hq", directory: path.join(root, "hq") }
]) {
  const result = spawnSync(npmCommand, ["sbom", "--sbom-format", "cyclonedx", "--omit=dev"], {
    cwd: project.directory,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Could not generate the ${project.name} SBOM.`);
  }
  const document = JSON.parse(result.stdout);
  if (document.bomFormat !== "CycloneDX" || !Array.isArray(document.components)) {
    throw new Error(`The ${project.name} SBOM is malformed.`);
  }
  const filename = path.join(outputDirectory, `${project.name}.cdx.json`);
  await writeFile(filename, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  console.log(filename);
}
