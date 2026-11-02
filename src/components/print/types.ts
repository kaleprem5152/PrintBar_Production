import type { ColorMode, Orientation, Sides } from "@/lib/config";

export type UDoc = {
  localId: string;
  file: File;
  name: string;
  size: number;
  kind: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  serverId?: string;
  pages: number;
  estimated: boolean;
  range: string;
  useRange: boolean;
};

export type Settings = {
  colorMode: ColorMode;
  copies: number;
  paperSize: string;
  sides: Sides;
  orientation: Orientation;
};

export type Cfg = {
  pricing: { bw: number; color: number };
  hardware: { paperSizes: string[]; sides: string[]; orientations: string[]; maxUploadBytes: number; maxFiles: number };
};

export const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
