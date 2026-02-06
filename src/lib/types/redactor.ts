export type ShapeType = "rectangle" | "square" | "circle" | "ellipse" | "freehand";
export type EffectType = "pixelate" | "blur" | "fill";

export interface Shape {
  type: ShapeType;
  /** Rectangle/square: [x, y, w, h]. Circle: [cx, cy, r]. Ellipse: [x, y, w, h]. Freehand: [x1,y1, x2,y2, ...] */
  points: number[];
  effect: EffectType;
  fillColor?: string;
  fillOpacity?: number;
  pixelSize?: number;
  blurRadius?: number;
}

export interface EffectOptions {
  fillColor: string;
  fillOpacity: number;
  pixelSize: number;
  blurRadius: number;
}
