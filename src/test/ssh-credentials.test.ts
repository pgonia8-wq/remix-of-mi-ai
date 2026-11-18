import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { connections, cleanKnownHosts, decodeCredential, encodeCredential } from "@/lib/connections";
import { remoteActivity } from "@/lib/automation/remote-activity";

// Exact paste from Fer's terminal: comments, three key types and the trailing prompt.
const PASTE = `azureuser@HTP:~$ ssh-keyscan -p 22 20.51.212.93
# 20.51.212.93:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20
20.51.212.93 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDIooIHynThrbBN98QJpDlyRMxkNdF5YL87KXpc76Y9Zgu4j04J8b80
# 20.51.212.93:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20
20.51.212.93 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG0hqXQi/rmLTl97cOM/QoPjNoMUW15Suql4H7dO34dC

20.51.212.93 ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBIYfpkCCezc093pr6gLCVCtz/ZwguOd8tU/DTpM3LTd3x8RFs4SzUZLHnvYoLKaERULxOuaQrgyvWFzlFuyFFhM=
azureuser@HTP:~$`;
const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\r\nb3BlbnNzaC1rZXktdjEAAAAA\r\n-----END OPENSSH PRIVATE KEY-----";

let repo: Repo;
beforeEach(async () => { const SQL = await initSqlJs(); repo = new Repo(wrapSqlJs(new SQL.Database()), { encrypt: async (x) => "encrypted:" + x.split("").reverse().join(""), decrypt: async (x) => x.slice(10).split("").reverse().join("") }); await repo.migrate(); });

describe("clave de host pegada desde ssh-keyscan", () => {
  it("quita comentarios y el prompt y deja las tres claves de 20.51.212.93", () => {
    const lines = cleanKnownHosts(PASTE, "20.51.212.93", 22).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("20.51.212.93 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG0hqXQi/rmLTl97cOM/QoPjNoMUW15Suql4H7dO34dC");
    expect(lines.every((l) => !l.includes("#") && !l.includes("$"))).toBe(true);
  });
  it("una línea sin host se asocia al servidor y puerto de la conexión", () => {
    expect(cleanKnownHosts("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG0h", "20.51.212.93", 2222)).toBe("[20.51.212.93]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG0h");
  });
  it("rechaza la clave de otro servidor y el texto sin claves", () => {
    expect(() => cleanKnownHosts(PASTE, "10.0.0.5", 22)).toThrow(/otro servidor/);
    expect(() => cleanKnownHosts("azureuser@HTP:~$", "20.51.212.93", 22)).toThrow(/ninguna clave/);
  });
  it("guardar la conexión almacena solo las líneas limpias", async () => {
    const p = await repo.createProject("A");
    await connections.save(repo, p.id, "HTP", { host: "20.51.212.93", port: 22, user: "azureuser", knownHosts: PASTE });
    const [c] = await connections.list(repo, p.id);
    expect((JSON.parse(c!.config) as { knownHosts: string }).knownHosts.split("\n")).toHaveLength(3);
  });
});

describe("credencial SSH: contraseña y/o clave privada", () => {
  it("una contraseña antigua sigue funcionando tal cual", () => {
    expect(decodeCredential("mi-clave")).toEqual({ password: "mi-clave" });
    expect(encodeCredential({ password: "mi-clave" })).toBe("mi-clave");
  });
  it("clave privada con frase de paso y contraseña viajan juntas", () => {
    const d = decodeCredential(encodeCredential({ privateKey: KEY, passphrase: "frase", password: "pw" }));
    expect(d.privateKey).toBe("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n");
    expect(d.passphrase).toBe("frase"); expect(d.password).toBe("pw");
  });
  it("rechaza claves PuTTY y texto que no es una clave", () => {
    expect(() => encodeCredential({ privateKey: "PuTTY-User-Key-File-3: ssh-rsa" })).toThrow(/PuTTY/);
    expect(() => encodeCredential({ privateKey: "hola" })).toThrow(/BEGIN/);
  });
  it("la credencial guardada no queda legible en la base de datos", async () => {
    const p = await repo.createProject("A");
    const id = await connections.save(repo, p.id, "HTP", { host: "20.51.212.93", port: 22, user: "azureuser", knownHosts: PASTE });
    await repo.saveConnectionSecret(p.id, id, encodeCredential({ privateKey: KEY }));
    const raw = await repo.sql.all<{ secret_enc: string }>("SELECT secret_enc FROM connection_secrets");
    expect(raw[0]!.secret_enc).not.toContain("BEGIN OPENSSH");
    expect(decodeCredential((await repo.getConnectionSecret(p.id, id))!).privateKey).toContain("BEGIN OPENSSH");
  });
});

describe("terminal de la VM", () => {
  it("muestra comando, salida, código y servidor de lo que hizo el agente, y lo que espera aprobación", async () => {
    const p = await repo.createProject("A"), q = await repo.createProject("B");
    const conn = await connections.save(repo, p.id, "HTP", { host: "20.51.212.93", port: 22, user: "azureuser", knownHosts: PASTE });
    const ins = (proj: string, kind: string, input: object, output: string, at: number) => repo.sql.run("INSERT INTO auto_observations VALUES (?,?,?,?,?,?,?,?,?,0,NULL,0,1200,?)", [crypto.randomUUID(), proj, "run1", "t1", "backend", kind, "ssh.exec", JSON.stringify(input), output, at]);
    await ins(p.id, "tool", { connectionId: conn, command: "whoami" }, "código=0\nazureuser\n", 1);
    await ins(p.id, "tool", { connectionId: conn, command: "npm test" }, "código=1\nfallo", 2);
    await ins(q.id, "tool", { connectionId: conn, command: "secreto" }, "código=0\n", 3);
    await repo.sql.run("INSERT INTO auto_approvals VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',1,?,NULL)", [crypto.randomUUID(), p.id, "run1", "t1", "ssh.exec", "fp", "s", "", null, "high", JSON.stringify({ connectionId: conn, command: "sudo apt install -y git" }), 4]);
    const e = await remoteActivity(repo, p.id, "run1");
    expect(e.map((x) => [x.command, x.state, x.exitCode])).toEqual([["whoami", "ok", 0], ["npm test", "failed", 1], ["sudo apt install -y git", "waiting", null]]);
    expect(e[0]!.output).toBe("azureuser\n");
    expect(e[0]!.target).toBe("HTP (20.51.212.93)");
    expect(await remoteActivity(repo, q.id)).toHaveLength(1);
  });
});
