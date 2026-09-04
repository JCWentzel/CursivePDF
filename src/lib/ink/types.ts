export type InkTool = "draw" | "erase";

export type InkPoint = {
  x: number;
  y: number;
  pressure: number;
  time: number;
  pointerType: string;
  tiltX?: number;
  tiltY?: number;
};

export type InkStroke = {
  id: string;
  pageIndex: number;
  color: string;
  width: number;
  opacity: number;
  points: InkPoint[];
};

export type RemovedStroke = {
  stroke: InkStroke;
  index: number;
};

export type InkAction =
  | {
      type: "add";
      stroke: InkStroke;
    }
  | {
      type: "erase";
      removed: RemovedStroke[];
    };
