import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryMovements } from "@/db/schema";
import { ApiError, audit, int, oneOf, route, str } from "@/lib/api";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { notify } from "@/lib/alerts";

export const dynamic = "force-dynamic";
const n = (v: unknown) => Number(v ?? 0);

export const GET = route("inventory.view", async () => {
  const items = await db.select().from(inventoryItems).orderBy(inventoryItems.category, inventoryItems.name);
  const usage = (await db.execute(sql`select item_id, coalesce(-sum(qty) filter (where kind='consumption'),0) used from inventory_movements where created_at >= now() - interval '30 days' group by 1`)).rows as Record<string, unknown>[];
  const lastBuy = (await db.execute(sql`select distinct on (item_id) item_id, created_at, supplier, unit_cost_paise from inventory_movements where kind='purchase' order by item_id, created_at desc`)).rows as Record<string, unknown>[];
  const monthly = (await db.execute(sql`select to_char(date_trunc('month', mv.created_at at time zone 'Asia/Kolkata'),'YYYY-MM') mon, i.category, coalesce(sum(mv.qty*coalesce(mv.unit_cost_paise,0)),0) spend
      from inventory_movements mv join inventory_items i on i.id=mv.item_id where mv.kind='purchase' and mv.created_at >= now() - interval '6 months' group by 1,2 order by 1`)).rows as Record<string, unknown>[];
  const movements = await db
    .select({ m: inventoryMovements, name: inventoryItems.name, unit: inventoryItems.unit })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(80);
  return {
    items: items.map((it) => {
      const used30 = n(usage.find((u) => n(u.item_id) === it.id)?.used);
      const perDay = used30 / 30;
      const lb = lastBuy.find((x) => n(x.item_id) === it.id);
      return {
        ...it,
        used30d: used30,
        perDay,
        daysLeft: perDay > 0 ? Math.floor(it.stock / perDay) : null,
        low: it.stock <= it.reorderThreshold,
        lastPurchase: lb ? { at: lb.created_at, supplier: lb.supplier, unitCostPaise: n(lb.unit_cost_paise) } : null,
      };
    }),
    monthly: monthly.map((r) => ({ month: String(r.mon), category: String(r.category), spendPaise: n(r.spend) })),
    movements: movements.map((x) => ({ ...x.m, itemName: x.name, unit: x.unit })),
  };
});

export const POST = route("inventory.manage", async ({ user, ip, body }) => {
  const b = await body();
  const action = oneOf(b.action, "action", ["create", "purchase", "adjust", "consume", "threshold"] as const);
  if (action === "create") {
    const category = oneOf(b.category, "Category", Object.keys(INVENTORY_CATEGORIES) as [string, ...string[]]);
    const [row] = await db
      .insert(inventoryItems)
      .values({
        sku: str(b.sku, "SKU", { max: 30 }).toUpperCase(),
        name: str(b.name, "Name", { max: 80 }),
        category,
        unit: str(b.unit, "Unit", { max: 20 }),
        stock: 0,
        reorderThreshold: int(b.reorderThreshold ?? 0, "Reorder threshold", { min: 0 }),
        unitCostPaise: Math.round(Number(b.unitCostRupees ?? 0) * 100) || 0,
      })
      .returning();
    await audit({ user, ip }, "inventory.create", "inventory", row.id, { sku: row.sku });
    return { ok: true, message: "Item created" };
  }
  const itemId = int(b.itemId, "Item", { min: 1 });
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) throw new ApiError(404, "Item not found");
  if (action === "threshold") {
    const t = int(b.reorderThreshold, "Reorder threshold", { min: 0 });
    await db.update(inventoryItems).set({ reorderThreshold: t }).where(eq(inventoryItems.id, itemId));
    await audit({ user, ip }, "inventory.threshold", "inventory", itemId, { from: item.reorderThreshold, to: t });
    return { ok: true, message: "Threshold updated" };
  }
  let qty = int(b.qty, "Quantity");
  if (action === "purchase") qty = Math.abs(qty);
  if (action === "consume") qty = -Math.abs(qty);
  if (qty === 0) throw new ApiError(400, "Quantity can't be zero");
  if (action === "adjust" && !String(b.note ?? "").trim()) throw new ApiError(400, "A reason is required for manual adjustments");
  if (item.stock + qty < 0) throw new ApiError(400, `Stock can't go below zero (current ${item.stock} ${item.unit})`);
  const unitCost = action === "purchase" ? Math.round(Number(b.unitCostRupees ?? item.unitCostPaise / 100) * 100) : null;
  await db.transaction(async (tx) => {
    await tx.insert(inventoryMovements).values({
      itemId, kind: action === "adjust" ? "adjustment" : action === "purchase" ? "purchase" : "consumption", qty,
      unitCostPaise: unitCost, supplier: str(b.supplier, "Supplier", { optional: true, max: 80 }) || null,
      reference: str(b.reference, "Reference", { optional: true, max: 60 }) || null,
      note: str(b.note, "Note", { optional: true, max: 200 }) || null, byName: user.name,
    });
    await tx.update(inventoryItems).set({ stock: sql`${inventoryItems.stock} + ${qty}`, ...(unitCost ? { unitCostPaise: unitCost } : {}) }).where(eq(inventoryItems.id, itemId));
  });
  await audit({ user, ip }, `inventory.${action}`, "inventory", itemId, { qty, before: item.stock, after: item.stock + qty, note: b.note ?? null });
  if (item.stock + qty <= item.reorderThreshold && item.stock > item.reorderThreshold) {
    await notify({ type: "low_consumable", severity: "warning", title: `${item.name} below reorder level`, body: `${item.stock + qty} ${item.unit} left (threshold ${item.reorderThreshold})`, link: "/admin/inventory" });
  }
  return { ok: true, message: `Stock updated: ${item.stock} → ${item.stock + qty} ${item.unit}` };
});
