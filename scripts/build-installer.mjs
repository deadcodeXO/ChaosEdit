import { access, copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const REPO_ROOT = process.cwd();
const localAppData = process.env.LOCALAPPDATA || "";
const useRepoOutput = process.argv.includes("--repo-output");

const localOutputDir = path.join(localAppData, "ChaosEditBuild", "release-installer");
const repoOutputDir = path.join(REPO_ROOT, "release-installer");

if (!useRepoOutput && !localAppData) {
  console.error("LOCALAPPDATA is not set; using repo output fallback.");
}

const outputCandidates = useRepoOutput
  ? [repoOutputDir]
  : [localOutputDir, repoOutputDir];

const electronDistDir = path.join(REPO_ROOT, "node_modules", "electron", "dist");
const electronExePath = path.join(electronDistDir, "electron.exe");
const electronPackageJsonPath = path.join(REPO_ROOT, "node_modules", "electron", "package.json");

let electronVersion = "";
try {
  const raw = await readFile(electronPackageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  electronVersion = typeof parsed?.version === "string" ? parsed.version : "";
} catch {
  // Fallback to builder default resolution.
}

try {
  await access(electronExePath);
} catch {
  console.error(`Local electron executable not found: ${electronExePath}`);
  process.exit(1);
}

async function prepareOutput(candidateDir) {
  const unpackedDir = path.join(candidateDir, "win-unpacked");
  await rm(unpackedDir, { recursive: true, force: true });
  await mkdir(candidateDir, { recursive: true });
}

let outputDir = "";
for (const candidate of outputCandidates) {
  try {
    await prepareOutput(candidate);
    outputDir = candidate;
    break;
  } catch {
    // Try next candidate path.
  }
}

if (!outputDir) {
  console.error("Unable to prepare installer output directory.");
  process.exit(1);
}

const cliPath = path.join(REPO_ROOT, "node_modules", "electron-builder", "cli.js");
const args = [
  cliPath,
  "--win",
  "nsis",
  "--config",
  "electron-builder.installer.standalone.json",
  "--publish",
  "never",
  "--config.npmRebuild=false",
  `--config.electronDist=${electronDistDir}`,
  ...(electronVersion ? [`--config.electronVersion=${electronVersion}`] : []),
  `--config.directories.output=${outputDir}`,
];

console.log(`Building installer output to: ${outputDir}`);
const startedAt = Date.now();

async function findNewestInstaller(directories) {
  let winner = null;
  for (const dir of directories) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.toLowerCase().endsWith(".exe")) continue;
        if (entry.name.toLowerCase().endsWith(".exe.blockmap")) continue;
        const fullPath = path.join(dir, entry.name);
        const info = await stat(fullPath);
        if (info.mtimeMs + 5000 < startedAt) continue;
        if (!winner || info.mtimeMs > winner.mtimeMs) {
          winner = { fullPath, fileName: entry.name, mtimeMs: info.mtimeMs };
        }
      }
    } catch {
      // Ignore inaccessible or missing dirs.
    }
  }
  return winner;
}

const child = spawn(process.execPath, args, {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    DEBUG: "electron-builder,electron-download",
    ELECTRON_BUILDER_LOG_LEVEL: "debug",
  },
});

child.on("exit", async code => {
  const exitCode = code ?? 1;
  if (exitCode === 0) {
    const installer = await findNewestInstaller([outputDir, repoOutputDir, localOutputDir]);
    if (!installer) {
      console.log("Build exited 0, but no fresh installer .exe was found.");
      process.exit(1);
      return;
    }

    const canonicalRepoOut = path.join(REPO_ROOT, "release-installer");
    const repoInstallerPath = path.join(canonicalRepoOut, installer.fileName);
    try {
      await mkdir(canonicalRepoOut, { recursive: true });
      if (installer.fullPath !== repoInstallerPath) {
        await copyFile(installer.fullPath, repoInstallerPath);
      }
      console.log(`Installer build complete: ${installer.fullPath}`);
      console.log(`Installer copied to repo output: ${repoInstallerPath}`);
    } catch {
      console.log(`Installer build complete: ${installer.fullPath}`);
      console.log("Installer copy to repo output failed, but installer exists at the path above.");
    }
  }
  process.exit(exitCode);
});

child.on("error", error => {
  console.error(error);
  process.exit(1);
});
