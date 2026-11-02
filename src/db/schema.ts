import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type OrderDoc = {
  id: string;
  name: string;
  size: number;
  pages: number; // total pages in file
  selected: number; // pages selected per copy
  range: string | null; // custom range (null = all)
  estimated: boolean;
  kind: string;
};

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  token: text("token").notNull(),
  pin: text("pin"),
  status: text("status").notNull().default("pending_payment"),
  docs: jsonb("docs").$type<OrderDoc[]>().notNull(),
  pagesPerCopy: integer("pages_per_copy").notNull(),
  copies: integer("copies").notNull().default(1),
  colorMode: text("color_mode").notNull(),
  paperSize: text("paper_size").notNull().default("A4"),
  sides: text("sides").notNull().default("single"),
  orientation: text("orientation").notNull().default("portrait"),
  amount: integer("amount").notNull(),
  pagesToPrint: integer("pages_to_print").notNull(),
  pagesPrinted: integer("pages_printed").notNull().default(0),
  printBaseline: integer("print_baseline").notNull().default(0),
  printStartedAt: timestamp("print_started_at"),
  failureReason: text("failure_reason"),
  paymentRef: text("payment_ref"),
  filesDeleted: boolean("files_deleted").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
});

export const kiosks = pgTable("kiosks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  state: text("state").notNull().default("ready"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
