// Phone side of the PC Node protocol; byte-compatible with pc-node/protocol.mjs (WebCrypto, no Buffer).
const te = new TextEncoder(), td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
export const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function generateKeys() {
  const kp = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  return { privateJwk: await subtle().exportKey("jwk", kp.privateKey), publicRaw: b64(new Uint8Array(await subtle().exportKey("raw", kp.publicKey))) };
}
export async function fingerprint(publicRaw: string) {
  const h = new Uint8Array(await subtle().digest("SHA-256", unb64(publicRaw) as BufferSource));
  return Array.from(h.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("").match(/.{4}/g)!.join("-");
}
export async function hmac(code: string, msg: string) {
  const k = await subtle().importKey("raw", te.encode(code), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await subtle().sign("HMAC", k, te.encode(msg))));
}
export function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export async function sessionKey(privateJwk: JsonWebKey, peerPublicRaw: string, devicePub: string, nodePub: string) {
  const priv = await subtle().importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await subtle().importKey("raw", unb64(peerPublicRaw) as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("miai-node-v1"), info: te.encode(`${devicePub}|${nodePub}`) }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function seal(key: CryptoKey, aad: string, obj: unknown) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(obj))));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function open<T>(key: CryptoKey, aad: string, box: { iv: string; ct: string }): Promise<T> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(box.iv) as BufferSource, additionalData: te.encode(aad) }, key, unb64(box.ct) as BufferSource);
  return JSON.parse(td.decode(pt)) as T;
}
export const pairProof = (code: string, devicePub: string, nodePub: string) => hmac(code, `pair|${devicePub}|${nodePub}`);
export const nodeProof = (code: string, devicePub: string, nodePub: string) => hmac(code, `node|${nodePub}|${devicePub}`);
