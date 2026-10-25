import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".artifacts", "node_modules"]);
const markdownFiles = [];

function localTarget(raw) {
  const value = raw.trim().replace(/^<|>$/g, "");
  if (!value || value.startsWith("#") || /^(?:https?:|mailto:|data:)/i.test(value)) return null;
  const withoutFragment = value.split("#", 1)[0].split("?", 1)[0];
  return decodeURIComponent(withoutFragment);
}

markdownFiles.push(...execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(name => name.endsWith(".md")).map(name => resolve(root, name)));

const failures = [];
for (const file of markdownFiles) {
  const source = readFileSync(file, "utf8");
  const targets = [];

  for (const match of source.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    targets.push(match[1]);
  }
  for (const match of source.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    targets.push(match[1]);
  }

  for (const raw of new Set(targets)) {
    const target = localTarget(raw);
    if (!target) continue;
    const absolute = target.startsWith("/") ? resolve(root, `.${target}`) : resolve(dirname(file), target);
    if (!existsSync(absolute)) failures.push(`${file.slice(root.length + 1)} -> ${raw}`);
  }
}

if (failures.length) {
  console.error("Broken local documentation links:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked local links in ${markdownFiles.length} Markdown files.`);
}
