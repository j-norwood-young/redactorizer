export type ShapeType = "rectangle" | "square" | "circle" | "ellipse" | "freehand";
export type EffectType = "pixelate" | "blur" | "fill";

/** Document opened in the app: either a single image or a multi-page PDF. */
export type DocumentSource =
  | { type: "image"; dataUrl: string }
  | { type: "pdf"; documentId: string; numPages: number };

/** Shapes per page index (0-based). For image docs, only page 0 is used. */
export type ShapesByPage = Record<number, Shape[]>;

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
