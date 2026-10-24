/* HOLOVERSE — VRM avatars (build 1).
   Your imported .vrm IS your body in the verse; no import, you're the orb.

   Storage: IndexedDB 'holoverse'/'avatars', one record per file keyed by
   its full sha-256. The wire only ever carries the first 16 hex chars of
   the hash + the filename (in the wisp payload); peers who lack the file
   pull it once over the data channel (avatarReq/avatarChunk in net.js)
   and cache it here, so the same avatar renders for them forever after.

   Loading mirrors SMASHVR v0.43: VRMUtils.rotateVRM0 compensates 0.x
   files by leaving PI on scene.rotation.y — that base yaw is CAPTURED at
   load and composed into the visual root, never overwritten (overwriting
   it is what made every VRM0 import face backwards in SMASHVR).

   Animation is procedural: VRM humanoid normalized bones get a walk/fly
   swing composed onto their rest quaternions (speed-driven), and
   vrm.update(dt) runs the model's own spring bones (hair/cloth). */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export const AVATAR_H = 1.7;              // target height, world units
export const AVATAR_MAX_BYTES = 24 * 1024 * 1024;

/* ---------------- identity ---------------- */

export async function hashBuffer(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const wireHash = (fullHash) => String(fullHash || '').slice(0, 16);

/* ---------------- storage ---------------- */

const DB_NAME = 'holoverse';
const STORE = 'avatars';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'h' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let out;
    fn(store, (v) => { out = v; });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

export async function storeAvatar(fullHash, name, buffer) {
  await idb('readwrite', (store) => store.put({ h: fullHash, name: String(name || 'avatar.vrm'), buf: buffer }));
}

export async function fetchAvatarByWire(wireH) {
  const all = await idb('readonly', (store, done) => {
    const req = store.getAll();
    req.onsuccess = () => done(req.result || []);
  });
  const rec = (all || []).find((r) => r && typeof r.h === 'string' && r.h.startsWith(wireH));
  return rec || null;
}

/* own-avatar pointer (tiny -> localStorage; the bytes live in IDB) */
const OWN_KEY = 'holo_avatar';
export function getOwnAvatarMeta() {
  try {
    const raw = localStorage.getItem(OWN_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return (m && m.h) ? { h16: wireHash(m.h), name: String(m.name || 'avatar.vrm') } : null;
  } catch (e) { return null; }
}
export function setOwnAvatarMeta(fullHash, name) {
  try {
    if (!fullHash) localStorage.removeItem(OWN_KEY);
    else localStorage.setItem(OWN_KEY, JSON.stringify({ h: fullHash, name: String(name || 'avatar.vrm') }));
  } catch (e) { /* ignore */ }
}

/* ---------------- loading ---------------- */

export async function loadVRM(buffer) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  try {
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('no VRM data in this file');
    const vrm0 = !!(vrm.meta && vrm.meta.metaVersion === '0');
    if (vrm0) VRMUtils.rotateVRM0(vrm);
    // rotateVRM0's compensation lives on scene.rotation.y — capture it.
    const baseYaw = vrm.scene.rotation.y || 0;
    vrm.scene.rotation.y = 0; // the visual root owns yaw from here
    return { vrm, vrm0, baseYaw };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- visual ---------------- */

const SWING_BONES = ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'];
const BEND_BONES = ['leftLowerArm', 'rightLowerArm', 'leftLowerLeg', 'rightLowerLeg'];

export function makeAvatarVisual(loaded) {
  const { vrm, baseYaw } = loaded;
  const group = new THREE.Group();       // positioned at the wisp point
  const root = new THREE.Group();        // yaw lives here
  root.rotation.y = baseYaw || 0;
  group.add(root);

  // Scale to AVATAR_H, feet at y=0 of root, then sink root so the model's
  // centre sits on the group origin (the wisp point = body centre).
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = size.y > 0 ? AVATAR_H / size.y : 1;
  vrm.scene.scale.setScalar(s);
  vrm.scene.position.y = -box.min.y * s;
  root.add(vrm.scene);
  root.position.y = -AVATAR_H / 2;

  // Capture rest quaternions for the bones we animate.
  const bones = {};
  if (vrm.humanoid) {
    for (const name of [...SWING_BONES, ...BEND_BONES, 'hips', 'spine', 'head']) {
      try {
        const node = vrm.humanoid.getNormalizedBoneNode(name);
        if (node) bones[name] = { node, rest: node.quaternion.clone() };
      } catch (e) { /* bone absent — fine */ }
    }
  }

  const _q = new THREE.Quaternion();
  const _x = new THREE.Vector3(1, 0, 0);
  const _z = new THREE.Vector3(0, 0, 1);
  let phase = 0;

  function swing(name, axis, angle) {
    const b = bones[name];
    if (!b) return;
    _q.setFromAxisAngle(axis, angle);
    b.node.quaternion.copy(b.rest).multiply(_q);
  }

  return {
    group,
    height: AVATAR_H,
    /* speed: horizontal speed (units/s); dt: seconds; t: clock seconds.
       grounded-ish drift reads as a gentle run; fast flight leans in. */
    update(dt, speed, t) {
      const sp = Math.max(0, speed || 0);
      phase += dt * (2.2 + sp * 1.15);
      const amp = Math.min(0.62, 0.14 + sp * 0.085);   // stride amplitude
      const idle = Math.sin(t * 1.6) * 0.03;            // breathing sway
      const sL = Math.sin(phase) * amp, sR = Math.sin(phase + Math.PI) * amp;
      swing('leftUpperArm', _x, sR + idle);
      swing('rightUpperArm', _x, sL + idle);
      swing('leftUpperLeg', _x, sL);
      swing('rightUpperLeg', _x, sR);
      swing('leftLowerLeg', _x, Math.max(0, -sL) * 0.7);
      swing('rightLowerLeg', _x, Math.max(0, -sR) * 0.7);
      swing('leftLowerArm', _x, -0.18 - Math.max(0, sR) * 0.3);
      swing('rightLowerArm', _x, -0.18 - Math.max(0, sL) * 0.3);
      // lean into fast flight a touch; bob with the stride
      root.rotation.x = Math.min(0.38, sp * 0.028);
      root.position.y = -AVATAR_H / 2 + Math.abs(Math.sin(phase)) * Math.min(0.09, sp * 0.012);
      try { vrm.update(dt); } catch (e) { /* spring bones are best-effort */ }
    },
    dispose() {
      vrm.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const k of Object.keys(m)) {
              const v = m[k];
              if (v && v.isTexture) v.dispose();
            }
            m.dispose();
          }
        }
      });
    },
  };
}
