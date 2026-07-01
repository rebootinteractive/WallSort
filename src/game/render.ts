import * as THREE from 'three';
import type { ColorKey } from '../shared/types';
import { COLOR_HEX, darken, lighten } from '../shared/colors';
import type { SepStatus } from './Board';

// --- layout constants (world units) ---------------------------------------
export const PITCH = 1.0; // center-to-center spacing of cells
const TILE_W = 0.92;
const TILE_H = 0.92;
const SEP_W = 0.98;
const SEP_H = 0.58;
const CORNER = 0.16;

export const SEP_INACTIVE = 0x2b3142;
export const SEP_ACTIVE = 0x49527d;
export const SEP_WILD = 0x2bb6c4; // empty separator that accepts any color

export function colX(c: number, cols: number): number {
  return (c - (cols - 1) / 2) * PITCH;
}
export function rowY(r: number): number {
  return -(r + 0.5) * PITCH;
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

// --- number textures (shared, read-only cache — safe across game sessions) --
const numTexCache = new Map<number, THREE.Texture>();
function numberTexture(n: number): THREE.Texture {
  const cached = numTexCache.get(n);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#eef1f8';
  ctx.font = `bold ${n >= 10 ? 64 : 80}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  numTexCache.set(n, tex);
  return tex;
}

// --- cell meshes ----------------------------------------------------------
export interface CellMesh {
  id: number;
  kind: 'tile' | 'sep';
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  target?: number;
  slabMat?: THREE.MeshBasicMaterial;
  spriteMat?: THREE.SpriteMaterial;
}

export function makeTile(id: number, color: ColorKey): CellMesh {
  const hex = COLOR_HEX[color];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const borderGeo = new THREE.ShapeGeometry(roundedRectShape(TILE_W + 0.06, TILE_H + 0.06, CORNER + 0.02));
  const borderMat = new THREE.MeshBasicMaterial({ color: darken(hex, 0.55), transparent: true, side: THREE.DoubleSide });
  const border = new THREE.Mesh(borderGeo, borderMat);

  const faceGeo = new THREE.ShapeGeometry(roundedRectShape(TILE_W, TILE_H, CORNER));
  const faceMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.z = 0.02;

  const hlGeo = new THREE.ShapeGeometry(roundedRectShape(TILE_W * 0.86, TILE_H * 0.3, CORNER * 0.6));
  const hlMat = new THREE.MeshBasicMaterial({ color: lighten(hex, 0.4), transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const hl = new THREE.Mesh(hlGeo, hlMat);
  hl.position.set(0, TILE_H * 0.26, 0.03);

  geometries.push(borderGeo, faceGeo, hlGeo);
  materials.push(borderMat, faceMat, hlMat);

  const group = new THREE.Group();
  group.add(border, face, hl);
  return { id, kind: 'tile', group, materials, geometries };
}

export function makeSep(id: number, target: number): CellMesh {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const slabGeo = new THREE.ShapeGeometry(roundedRectShape(SEP_W, SEP_H, CORNER * 0.7));
  const slabMat = new THREE.MeshBasicMaterial({ color: SEP_INACTIVE, transparent: true, side: THREE.DoubleSide });
  const slab = new THREE.Mesh(slabGeo, slabMat);

  const spriteMat = new THREE.SpriteMaterial({ map: numberTexture(target), transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(SEP_H * 0.85, SEP_H * 0.85, 1);
  sprite.position.z = 0.05;

  geometries.push(slabGeo);
  materials.push(slabMat, spriteMat);

  const group = new THREE.Group();
  group.add(slab, sprite);
  return { id, kind: 'sep', group, materials, geometries, target, slabMat, spriteMat };
}

export function updateSep(m: CellMesh, status: SepStatus, wildcard = false): void {
  if (!m.spriteMat || !m.slabMat) return;
  const shown = status.active ? status.remaining : (m.target ?? 10);
  m.spriteMat.map = numberTexture(shown);
  m.spriteMat.needsUpdate = true;
  if (wildcard) {
    // Exposed empty separator: highlight it as an "accepts anything" slot.
    m.slabMat.color.setHex(SEP_WILD);
    m.spriteMat.opacity = 1;
  } else {
    m.slabMat.color.setHex(status.active ? SEP_ACTIVE : SEP_INACTIVE);
    m.spriteMat.opacity = status.active ? 1 : 0.5;
  }
}

export function disposeCellMesh(m: CellMesh): void {
  m.group.parent?.remove(m.group);
  for (const g of m.geometries) g.dispose();
  for (const mat of m.materials) mat.dispose();
  // Note: number textures live in the shared read-only cache; not disposed here.
}
