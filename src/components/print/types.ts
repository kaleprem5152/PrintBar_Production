import type { ColorMode, Orientation, Sides } from "@/lib/config";
import type { PagesPerSheet } from "@/lib/pricing";

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
  colorMode:     ColorMode;
  copies:        number;
  paperSize:     string;
  sides:         Sides;
  orientation:   Orientation;
  pagesPerSheet: PagesPerSheet; // 1, 2, 4, 6
};

export type Cfg = {
  pricing: {
    bw: number;
    color: number;
    billingBasis?: "per_sheet" | "per_side";
    minOrderAmount?: number;
  };
  hardware: {
    paperSizes: readonly string[] | string[];
    sides: readonly string[] | string[];
    orientations: readonly string[] | string[];
    pagesPerSheet: readonly number[] | number[];
    maxUploadBytes: number;
    maxFiles: number;
  };
  paper?: {
    outOfPaper: boolean;
    paperReady: boolean;
    maintenanceMode: boolean;
  };
};

export const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
