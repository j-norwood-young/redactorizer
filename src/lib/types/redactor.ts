export type ShapeType = "rectangle" | "square" | "circle" | "freehand";
export type EffectType = "pixelate" | "blur" | "fill";

export interface Shape {
  type: ShapeType;
  /** Rectangle/square: [x, y, w, h]. Circle: [cx, cy, r]. Freehand: [x1,y1, x2,y2, ...] */
  points: number[];
  effect: EffectType;
  fillColor?: string;
  pixelSize?: number;
  blurRadius?: number;
}

export interface EffectOptions {
  fillColor: string;
  pixelSize: number;
  blurRadius: number;
}
