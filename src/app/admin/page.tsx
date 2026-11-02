"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo, Icon } from "@/components/ui/Icon";
import { rupees } from "@/lib/config";

type StatsData = {
  revenue: { total: number; today: number };
  pages: { total: number; bw: number; color: number };
  jobs: { total: number; completed: number; active: number; failed: number };
  devices: Array<{
    id: string;
    name: string;
    location: string;
    isActive: boolean;
    kyoceraReady: boolean | null;
    canonReady: boolean | null;
    maintenanceMode: boolean;
    lastHeartbeat: string | null;
  }>;
};

type OrderItem = {
  id: number;
  orderId: string;
  status: string;
  colorMode: string;
  pagesToPrint: number;
  pagesPrinted: number;
  copies: number;
  amount: number;
  pin: string | null;
  deviceId: string | null;
  printerUsed: string | null;
  failureReason: string | null;
  paidAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, ordersRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/orders?limit=30"),
      ]);

      if (statsRes.status === 401) {
        router.push("/admin/login");
        return;
      }

      if (statsRes.ok && ordersRes.ok) {
        const statsData = await statsRes.json();
        const ordersData = await ordersRes.json();
        setStats(statsData);
        setOrders(ordersData.orders || []);
      }
    } catch (err) {
      console.error("Dashboard poll error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 8000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  };

  const toggleMaintenance = async (deviceId: string, current: boolean) => {
    setToggling(true);
    try {
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, maintenanceMode: !current }),
      });
      if (res.ok) {
        await fetchDashboardData();
      }
    } finally {
      setToggling(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (filter === "active") return ["queued", "claimed", "processing", "printing", "fallback_printing"].includes(o.status);
    if (filter === "completed") return o.status === "completed";
    if (filter === "failed") return o.status === "failed";
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">Completed</span>;
      case "printing":
      case "fallback_printing":
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20 animate-pulse">Printing</span>;
      case "processing":
      case "claimed":
      case "queued":
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-400 border border-blue-500/20">Queued</span>;
      case "paid":
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-400 border border-purple-500/20">PIN Issued</span>;
      case "failed":
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-400 border border-rose-500/20">Failed</span>;
      default:
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-500/10 px-2.5 py-1 text-xs font-semibold text-gray-400 border border-gray-500/20">{status}</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-[#8a929e]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <p className="text-sm">Connecting to PrintBar Telemetry...</p>
        </div>
      </div>
    );
  }

  const primaryDevice = stats?.devices[0] ?? {
    id: "PB-K01",
    name: "PrintBar Kiosk 01",
    location: "Central Library Entrance",
    isActive: true,
    kyoceraReady: true,
    canonReady: true,
    maintenanceMode: false,
    lastHeartbeat: new Date().toISOString(),
  };

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#ededed]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#12151a]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10">
              <Logo />
            </div>
            <div>
              <span className="font-bold tracking-tight text-white">PrintBar Console</span>
              <span className="ml-2 rounded-md bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-400/20">
                PROD
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs text-[#8a929e]">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Live Telemetry</span>
            </div>

            <button
              onClick={handleLogout}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10 text-white transition"
            >
              Log Out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        {/* Metric Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-white/10 bg-[#15191e] p-5 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a929e]">Today&apos;s Revenue</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white">
              {rupees(stats?.revenue.today ?? 0)}
            </p>
            <p className="mt-1 text-xs text-[#8a929e]">
              All-time: <span className="text-white font-medium">{rupees(stats?.revenue.total ?? 0)}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#15191e] p-5 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a929e]">Pages Output</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white">
              {(stats?.pages.total ?? 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-[#8a929e]">
              B&W: <span className="text-white font-medium">{stats?.pages.bw}</span> · Color: <span className="text-white font-medium">{stats?.pages.color}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#15191e] p-5 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a929e]">Job Completion</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-400">
              {stats?.jobs.completed ?? 0}
            </p>
            <p className="mt-1 text-xs text-[#8a929e]">
              Active: <span className="text-amber-400 font-medium">{stats?.jobs.active}</span> · Failed: <span className="text-rose-400 font-medium">{stats?.jobs.failed}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#15191e] p-5 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a929e]">Kiosk Status</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${primaryDevice.maintenanceMode ? "bg-rose-500" : "bg-emerald-400"}`} />
              <span className="text-xl font-bold text-white">
                {primaryDevice.maintenanceMode ? "Maintenance" : "Online & Active"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#8a929e]">Device ID: {primaryDevice.id}</p>
          </div>
        </section>

        {/* Machine Hardware & CUPS Telemetry */}
        <section className="rounded-3xl border border-white/10 bg-[#15191e] p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Physical Hardware Unit: {primaryDevice.name}
              </h2>
              <p className="text-xs text-[#8a929e] mt-0.5">{primaryDevice.location}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                disabled={toggling}
                onClick={() => toggleMaintenance(primaryDevice.id, primaryDevice.maintenanceMode)}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  primaryDevice.maintenanceMode
                    ? "bg-emerald-500 text-black hover:bg-emerald-400"
                    : "border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                }`}
              >
                {primaryDevice.maintenanceMode ? "Exit Maintenance (Resume Kiosk)" : "Put in Maintenance Mode"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Kyocera Primary */}
            <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-white">Kyocera ECOSYS PA3500x</h3>
                  <p className="text-xs text-[#8a929e]">Primary High-Speed B&W Laser</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  primaryDevice.kyoceraReady !== false ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {primaryDevice.kyoceraReady !== false ? "Ready · 35 ppm" : "Fault / Check Paper"}
                </span>
              </div>
            </div>

            {/* Canon Primary Color & Fallback */}
            <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-white">Canon MAXIFY GX6170</h3>
                  <p className="text-xs text-[#8a929e]">Colour Pigment Ink & Auto-B&W Fallback</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  primaryDevice.canonReady !== false ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {primaryDevice.canonReady !== false ? "Ready · Failover Enabled" : "Fault / Offline"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Live Orders Table */}
        <section className="rounded-3xl border border-white/10 bg-[#15191e] overflow-hidden shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b border-white/10">
            <div>
              <h2 className="text-lg font-bold text-white">Recent Transactions & Print Jobs</h2>
              <p className="text-xs text-[#8a929e] mt-0.5">Real-time job queue and ledger</p>
            </div>

            {/* Filter buttons */}
            <div className="flex rounded-xl bg-black/40 p-1 border border-white/5">
              {["all", "active", "completed", "failed"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    filter === f ? "bg-white/10 text-white" : "text-[#8a929e] hover:text-white"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/5 bg-black/20 text-[#8a929e] uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-6">Order Ref</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6">Mode</th>
                  <th className="py-3 px-6">Pages</th>
                  <th className="py-3 px-6">Amount</th>
                  <th className="py-3 px-6">PIN</th>
                  <th className="py-3 px-6">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-[#d0d6e0]">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#8a929e]">
                      No orders found matching filter.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.orderId} className="hover:bg-white/[0.02] transition">
                      <td className="py-4 px-6 font-mono font-semibold text-white">
                        {o.orderId}
                      </td>
                      <td className="py-4 px-6">
                        {getStatusBadge(o.status)}
                      </td>
                      <td className="py-4 px-6 uppercase font-semibold">
                        <span className={o.colorMode === "color" ? "text-amber-400" : "text-[#8a929e]"}>
                          {o.colorMode}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-mono">
                        {o.pagesPrinted} / {o.pagesToPrint}
                      </td>
                      <td className="py-4 px-6 font-semibold text-white">
                        {rupees(o.amount)}
                      </td>
                      <td className="py-4 px-6 font-mono tracking-wider font-bold text-amber-400">
                        {o.pin || "—"}
                      </td>
                      <td className="py-4 px-6 text-[#8a929e]">
                        {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
