// Repository intelligence: pure analysis of a project tree (technologies, dependencies, import graph,
// references, side-effect radius) plus git porcelain parsing. Git commands themselves run via the "git" tool.
export type RepoFile = { path: string; content?: string };
export type RepoReport = { technologies: string[]; dependencies: Record<string, string[]>; entrypoints: string[]; imports: Record<string, string[]>; files: number };
const TECH: [RegExp, string][] = [[/(^|\/)package\.json$/, "Node.js"], [/\.tsx?$/, "TypeScript"], [/\.jsx?$/, "JavaScript"], [/\.py$/, "Python"], [/(^|\/)Cargo\.toml$/, "Rust"], [/(^|\/)go\.mod$/, "Go"], [/\.kt$/, "Kotlin"], [/\.java$/, "Java"], [/(^|\/)build\.gradle(\.kts)?$/, "Gradle/Android"], [/\.(c|h)$/, "C"], [/\.(cpp|hpp|cc)$/, "C++"], [/\.cs$/, "C#"], [/\.sol$/, "Solidity"], [/\.sql$/, "SQL"], [/\.html?$/, "HTML"], [/\.css$/, "CSS"], [/(^|\/)Dockerfile$/, "Docker"]];
export function analyzeRepo(files: RepoFile[]): RepoReport {
  const tech = new Set<string>(), deps: Record<string, string[]> = {}, imports: Record<string, string[]> = {}, entry: string[] = [];
  for (const f of files) {
    for (const [re, t] of TECH) if (re.test(f.path)) tech.add(t);
    if (/(^|\/)(index|main|app)\.(t|j)sx?$|(^|\/)main\.(py|go|rs|kt)$/.test(f.path)) entry.push(f.path);
    if (!f.content) continue;
    if (f.path.endsWith("package.json")) { try { const j = JSON.parse(f.content) as Record<string, Record<string, string>>; deps["npm"] = Object.keys({ ...j["dependencies"], ...j["devDependencies"] }); } catch { /* invalid manifest */ } }
    if (f.path.endsWith("requirements.txt")) deps["pip"] = f.content.split("\n").map((l) => l.split(/[=<>~ ]/)[0]!.trim()).filter(Boolean);
    if (f.path.endsWith("Cargo.toml")) deps["cargo"] = [...f.content.matchAll(/^([\w-]+)\s*=/gm)].map((m) => m[1]!).filter((x) => !["name", "version", "edition"].includes(x));
    if (/\.(t|j)sx?$/.test(f.path)) imports[f.path] = [...f.content.matchAll(/(?:import[^'"]*from\s*|import\s*\(|require\()\s*['"]([^'"]+)['"]/g)].map((m) => resolveImport(f.path, m[1]!)).filter((x): x is string => !!x);
    if (f.path.endsWith(".py")) imports[f.path] = [...f.content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)].map((m) => `${(m[1] ?? m[2])!.replace(/\./g, "/")}.py`);
  }
  return { technologies: [...tech].sort(), dependencies: deps, entrypoints: entry, imports, files: files.length };
}
function resolveImport(from: string, spec: string) {
  if (!spec.startsWith(".")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const s of spec.split("/")) { if (s === "..") parts.pop(); else if (s !== ".") parts.push(s); }
  return parts.join("/");
}
/** Files that import the changed file, transitively (who may break). */
export function impactOf(report: RepoReport, changed: string) {
  const strip = (p: string) => p.replace(/\.(t|j)sx?$/, "").replace(/\/index$/, "");
  const target = strip(changed), hit = new Set<string>([target]), out = new Set<string>();
  let grew = true;
  while (grew) { grew = false; for (const [f, list] of Object.entries(report.imports)) if (!out.has(f) && list.some((i) => hit.has(strip(i)))) { out.add(f); hit.add(strip(f)); grew = true; } }
  out.delete(changed); return [...out].sort();
}
export type GitStatus = { branch: string | null; staged: string[]; modified: string[]; untracked: string[]; conflicts: string[] };
export function parseGitStatus(porcelain: string): GitStatus {
  const s: GitStatus = { branch: null, staged: [], modified: [], untracked: [], conflicts: [] };
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("## ")) { s.branch = line.slice(3).split("...")[0]!.trim(); continue; }
    if (line.length < 4) continue;
    const xy = line.slice(0, 2), path = line.slice(3);
    if (/^(UU|AA|DD|AU|UA|DU|UD)$/.test(xy)) s.conflicts.push(path);
    else if (xy === "??") s.untracked.push(path);
    else { if (xy[0] !== " ") s.staged.push(path); if (xy[1] !== " ") s.modified.push(path); }
  }
  return s;
}
/** Human work protection: refuse to touch files modified outside this run. */
export function humanChanges(status: GitStatus, ownedByRun: string[]) { return [...status.modified, ...status.staged].filter((f) => !ownedByRun.includes(f)); }
