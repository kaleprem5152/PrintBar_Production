export type PrinterState = "ready" | "offline" | "paper_out" | "paper_jam" | "error";

export type KOrder = {
  orderId: string;
  status: string;
  docs: { name: string; pages: number; selected: number }[];
  totalPages: number;
  pagesPerCopy: number;
  copies: number;
  colorMode: "bw" | "color";
  paperSize: string;
  sides: "single" | "double";
  amount: number;
  pagesPrinted: number;
  pagesRemaining: number;
  progress: number;
  currentDocument: string | null;
  failureReason: string | null;
};

export type ErrorKind =
  | "invalid_pin"
  | "expired_pin"
  | "printer_offline"
  | "paper_out"
  | "paper_jam"
  | "network"
  | "print_failed";

export const SAMPLE_ORDER: KOrder = {
  orderId: "PB-2026-00142",
  status: "pin_accepted",
  docs: [{ name: "Semester_Notes.pdf", pages: 30, selected: 30 }],
  totalPages: 30,
  pagesPerCopy: 30,
  copies: 1,
  colorMode: "bw",
  paperSize: "A4",
  sides: "single",
  amount: 60,
  pagesPrinted: 12,
  pagesRemaining: 18,
  progress: 40,
  currentDocument: "Semester_Notes.pdf",
  failureReason: null,
};
