// MI AI PC Node wire protocol (shared by the node service and its tests). WebCrypto only: Node 20+ and browsers.
// Pairing: ECDH P-256 static keys + one-time code proofs (HMAC) in both directions => mutual authentication.
// Session: HKDF(ECDH) -> AES-256-GCM, strictly increasing counter per device in the AAD => no replay.
const te = new TextEncoder(), td = new TextDecoder();
const subtle = globalThis.crypto.subtle;
export const b64 = (u) => Buffer.from(u).toString("base64");
export const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
export async function generateKeys() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { privateJwk: await subtle.exportKey("jwk", kp.privateKey), publicRaw: b64(new Uint8Array(await subtle.exportKey("raw", kp.publicKey))) };
}
export async function fingerprint(publicRaw) {
  const h = new Uint8Array(await subtle.digest("SHA-256", unb64(publicRaw)));
  return Buffer.from(h.subarray(0, 8)).toString("hex").match(/.{4}/g).join("-");
}
export async function hmac(code, msg) {
  const k = await subtle.importKey("raw", te.encode(code), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await subtle.sign("HMAC", k, te.encode(msg))));
}
export function safeEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export async function sessionKey(privateJwk, peerPublicRaw, devicePub, nodePub) {
  const priv = await subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await subtle.importKey("raw", unb64(peerPublicRaw), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("miai-node-v1"), info: te.encode(`${devicePub}|${nodePub}`) }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function seal(key, aad, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(obj))));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function open(key, aad, box) {
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv), additionalData: te.encode(aad) }, key, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}
export const pairProof = (code, devicePub, nodePub) => hmac(code, `pair|${devicePub}|${nodePub}`);
export const nodeProof = (code, devicePub, nodePub) => hmac(code, `node|${nodePub}|${devicePub}`);
