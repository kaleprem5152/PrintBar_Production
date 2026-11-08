import { desc } from "drizzle-orm";
import { db } from "@/db";
import { devices, orders } from "@/db/schema";
import { getAuthenticatedAdmin } from "@/lib/server/admin-auth";
import { listRecentOrders, getDevicePrinterStatus } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let allOrders: Array<typeof orders.$inferSelect> = [];
    let allDevices: Array<typeof devices.$inferSelect> = [];

    try {
      allOrders = await db.select().from(orders).orderBy(desc(orders.id));
      allDevices = await db.select().from(devices);
    } catch {
      allOrders = await listRecentOrders(100);
      const st = await getDevicePrinterStatus("PB-K01");
      allDevices = [
        {
          id: "PB-K01",
          name: "PrintBar Kiosk 01",
          location: "Central Library · Ground floor",
          secretHash: "demo",
          isActive: true,
          lastHeartbeat: new Date(),
          kyoceraReady: st.kyoceraReady,
          canonReady: st.canonReady,
          maintenanceMode: st.maintenanceMode,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let totalRevenue = 0;
    let todayRevenue = 0;
    let bwPages = 0;
    let colorPages = 0;
    let completedJobs = 0;
    let activeJobs = 0;
    let failedJobs = 0;

    const paidStatuses = [
      "paid", "pin_accepted", "queued", "claimed", "processing",
      "printing", "fallback_pending", "fallback_printing", "completed"
    ];
    const activeStatuses = ["queued", "claimed", "processing", "printing", "fallback_pending", "fallback_printing"];

    for (const o of allOrders) {
      if (paidStatuses.includes(o.status)) {
        totalRevenue += o.amount;
        if (o.paidAt && new Date(o.paidAt).getTime() >= startOfToday) {
          todayRevenue += o.amount;
        }
        if (o.colorMode === "color") {
          colorPages += o.pagesPrinted || o.pagesToPrint;
        } else {
          bwPages += o.pagesPrinted || o.pagesToPrint;
        }
      }

      if (o.status === "completed") completedJobs++;
      else if (o.status === "failed") failedJobs++;
      else if (activeStatuses.includes(o.status)) activeJobs++;
    }

    return Response.json({
      revenue: {
        total: totalRevenue,
        today: todayRevenue,
      },
      pages: {
        total: bwPages + colorPages,
        bw: bwPages,
        color: colorPages,
      },
      jobs: {
        total: allOrders.length,
        completed: completedJobs,
        active: activeJobs,
        failed: failedJobs,
      },
      devices: allDevices.map((d) => ({
        id:              d.id,
        name:            d.name,
        location:        d.location,
        isActive:        d.isActive,
        kyoceraReady:    d.kyoceraReady,
        canonReady:      d.canonReady,
        maintenanceMode: d.maintenanceMode,
        lastHeartbeat:   d.lastHeartbeat,
      })),
    });
  } catch (err) {
    console.error("[admin stats] error:", err);
    return Response.json({ error: "Failed to load stats." }, { status: 500 });
  }
}
