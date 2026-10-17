export interface SheetInfo {
  file: string;
  frameW: number;
  frameH: number;
  frames: number;
  bbox: number[];
  first: number[];
  cols?: number;
  rows?: number;
}
/** public/arena-assets/manifest.json, written by tools/prep_arena_assets.py */
export interface ArenaManifest {
  sheets: Record<string, SheetInfo>;
  vfx: Record<string, SheetInfo>;
  raw: Record<string, { file: string; size: number[] }[]>;
  chars: Record<string, string>;
  env: Record<string, { file: string; w: number; h: number }>;
  audio?: Record<string, string>;
  music?: Record<string, { file: string; bpm: number; phase: number; conf: number; seconds: number }>;
}
