"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark, Icon } from "@/components/ui/Icon";
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
    kyoceraPaper?: number;
    canonPaper?: number;
    paperReady?: boolean;
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
  refundStatus?: string;
  refundedAmount?: number;
  cleanupStatus?: string;
  paidAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type RefundItem = {
  id: number;
  orderId: string;
  cashfreeRefundId: string | null;
  cashfreePaymentId: string | null;
  requestedAmount: number;
  completedAmount: number;
  currency: string;
  reason: string | null;
  status: string;
  failureReason: string | null;
  initiatedBy: string;
  createdAt: string;
  completedAt: string | null;
  orderStatus: string | null;
};

type PricingData = {
  bwPerPage: number;
  colorPerPage: number;
  billingBasis: "per_sheet" | "per_side";
  minOrderAmount: number;
  currency: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "refunds" | "pricing" | "reconciliation">("overview");

  const [stats, setStats] = useState<StatsData | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  // Refund Management State
  const [refunds, setRefunds] = useState<RefundItem[]>([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [syncingRefunds, setSyncingRefunds] = useState(false);
  const [manualRefund, setManualRefund] = useState({ orderId: "", amount: "", reason: "" });
  const [refundMsg, setRefundMsg] = useState<{ text: string; error?: boolean } | null>(null);

  // Pricing State
  const [pricing, setPricing] = useState<PricingData>({
    bwPerPage: 2,
    colorPerPage: 8,
    billingBasis: "per_sheet",
    minOrderAmount: 2,
    currency: "INR",
  });
  const [savingPricing, setSavingPricing] = useState(false);
  const [pricingMsg, setPricingMsg] = useState<{ text: string; error?: boolean } | null>(null);

  // Reconciliation State
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any | null>(null);
  const [cleaningStorage, setCleaningStorage] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [refillingPaper, setRefillingPaper] = useState<string | null>(null);

  const handleRefillPaper = async (printer: "kyocera" | "canon") => {
    setRefillingPaper(printer);
    try {
      const res = await fetch("/api/admin/refill-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: primaryDevice.id, printer, amount: 250 }),
      });
      if (res.ok) {
        await fetchDashboardData();
      }
    } finally {
      setRefillingPaper(null);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const [statsRes, ordersRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/orders?limit=40"),
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

  const fetchRefunds = async () => {
    setRefundLoading(true);
    try {
      const res = await fetch("/api/admin/refunds");
      if (res.ok) {
        const data = await res.json();
        setRefunds(data.refunds || []);
      }
    } catch (err) {
      console.error("Failed to fetch refunds:", err);
    } finally {
      setRefundLoading(false);
    }
  };

  const fetchPricing = async () => {
    try {
      const res = await fetch("/api/admin/pricing");
      if (res.ok) {
        const data = await res.json();
        setPricing({
          bwPerPage: data.bwPerPage ?? 2,
          colorPerPage: data.colorPerPage ?? 8,
          billingBasis: data.billingBasis ?? "per_sheet",
          minOrderAmount: data.minOrderAmount ?? 2,
          currency: data.currency ?? "INR",
        });
      }
    } catch (err) {
      console.error("Failed to fetch pricing:", err);
    }
  };

  useEffect(() => {
    void fetchDashboardData();
    void fetchPricing();
    const interval = setInterval(fetchDashboardData, 8000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "refunds") {
      void fetchRefunds();
    }
  }, [activeTab]);

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

  const handleManualRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    setRefundMsg(null);
    if (!manualRefund.orderId) {
      setRefundMsg({ text: "Order ID is required", error: true });
      return;
    }

    try {
      const res = await fetch("/api/admin/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: manualRefund.orderId.trim(),
          amount: manualRefund.amount ? parseFloat(manualRefund.amount) : undefined,
          reason: manualRefund.reason.trim() || "Manual refund by operator",
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRefundMsg({ text: `Refund submitted successfully! Status: ${data.status}` });
        setManualRefund({ orderId: "", amount: "", reason: "" });
        await fetchRefunds();
        await fetchDashboardData();
      } else {
        setRefundMsg({ text: data.error || "Refund request failed.", error: true });
      }
    } catch (err) {
      setRefundMsg({ text: (err as Error).message, error: true });
    }
  };

  const handleSyncRefunds = async () => {
    setSyncingRefunds(true);
    setRefundMsg(null);
    try {
      const res = await fetch("/api/admin/refunds/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setRefundMsg({ text: `Synchronized ${data.syncedCount} pending refund(s) with Cashfree.` });
        await fetchRefunds();
        await fetchDashboardData();
      } else {
        setRefundMsg({ text: data.error || "Sync failed.", error: true });
      }
    } catch (err) {
      setRefundMsg({ text: (err as Error).message, error: true });
    } finally {
      setSyncingRefunds(false);
    }
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPricing(true);
    setPricingMsg(null);
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricing),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setPricingMsg({ text: "Pricing rates successfully saved to database." });
      } else {
        setPricingMsg({ text: data.error || "Failed to update pricing.", error: true });
      }
    } catch (err) {
      setPricingMsg({ text: (err as Error).message, error: true });
    } finally {
      setSavingPricing(false);
    }
  };

  const handleRunReconciliation = async () => {
    setRunningReconciliation(true);
    try {
      const res = await fetch("/api/admin/reconciliation", { method: "POST" });
      const data = await res.json();
      setReconcileResult(data);
      await fetchDashboardData();
    } catch (err) {
      setReconcileResult({ error: (err as Error).message });
    } finally {
      setRunningReconciliation(false);
    }
  };

  const handleStorageCleanup = async () => {
    setCleaningStorage(true);
    setCleanupResult(null);
    try {
      const res = await fetch("/api/admin/cleanup", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setCleanupResult(`Privacy sweep completed. Removed ${data.sweptFilesCount} expired customer document(s).`);
      } else {
        setCleanupResult(`Cleanup error: ${data.error}`);
      }
    } catch (err) {
      setCleanupResult(`Cleanup error: ${(err as Error).message}`);
    } finally {
      setCleaningStorage(false);
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
      case "refunded":
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-2.5 py-1 text-xs font-semibold text-teal-400 border border-teal-500/20">Refunded</span>;
      default:
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-500/10 px-2.5 py-1 text-xs font-semibold text-gray-400 border border-gray-500/20">{status}</span>;
    }
  };

  const getRefundBadge = (status: string) => {
    switch (status) {
      case "SUCCESS":
      case "REFUNDED":
        return <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">Success</span>;
      case "PENDING":
      case "REFUND_PROCESSING":
        return <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/20 animate-pulse">Processing</span>;
      case "REFUND_REQUIRES_REVIEW":
        return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-400 border border-blue-500/20">Review Required</span>;
      case "FAILED":
      case "REFUND_FAILED":
        return <span className="inline-flex items-center rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-400 border border-rose-500/20">Failed</span>;
      default:
        return <span className="inline-flex items-center rounded-full bg-gray-500/10 px-2.5 py-0.5 text-xs font-semibold text-gray-400 border border-gray-500/20">{status}</span>;
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
    kyoceraPaper: 250,
    canonPaper: 250,
    paperReady: true,
    maintenanceMode: false,
    lastHeartbeat: new Date().toISOString(),
  };

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#ededed]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#12151a]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-inner">
              <LogoMark size={24} />
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

        {/* Tab Selector */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex gap-2 border-t border-white/5 overflow-x-auto">
          {[
            { id: "overview", label: "Overview & Jobs" },
            { id: "refunds", label: "Cashfree Refunds" },
            { id: "pricing", label: "Pricing & Hardware" },
            { id: "reconciliation", label: "Reconciliation & Cleanup" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-[#8a929e] hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8">
        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW & JOBS                                                    */}
        {/* ========================================================================= */}
        {activeTab === "overview" && (
          <>
            {/* Metric Cards */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
                <p className="text-xs font-semibold uppercase tracking-wider text-[#8a929e]">Paper Inventory</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${(primaryDevice.kyoceraPaper ?? 0) > 0 || (primaryDevice.canonPaper ?? 0) > 0 ? "bg-emerald-400" : "bg-rose-500 animate-pulse"}`} />
                  <span className="text-xl font-bold text-white">
                    {(primaryDevice.kyoceraPaper ?? 0) + (primaryDevice.canonPaper ?? 0)} sheets
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#8a929e]">
                  B&amp;W: <span className="text-white font-medium">{primaryDevice.kyoceraPaper ?? 250}</span> · Color: <span className="text-white font-medium">{primaryDevice.canonPaper ?? 250}</span>
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
                      <th className="py-3 px-6">Refund</th>
                      <th className="py-3 px-6">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[#d0d6e0]">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#8a929e]">
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
                          <td className="py-4 px-6">
                            {o.refundStatus && o.refundStatus !== "NOT_REQUIRED" ? (
                              getRefundBadge(o.refundStatus)
                            ) : (
                              <span className="text-[#8a929e]">—</span>
                            )}
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
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: CASHFREE REFUNDS                                                   */}
        {/* ========================================================================= */}
        {activeTab === "refunds" && (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-white/10 bg-[#15191e] p-6 shadow-xl">
              <div>
                <h2 className="text-lg font-bold text-white">Cashfree Refund Management</h2>
                <p className="text-xs text-[#8a929e] mt-0.5">Authoritative server-side refund initiation &amp; status polling</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={syncingRefunds}
                  onClick={handleSyncRefunds}
                  className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-400/20 transition disabled:opacity-50"
                >
                  {syncingRefunds ? "Syncing..." : "Sync Pending from Cashfree"}
                </button>
              </div>
            </div>

            {refundMsg && (
              <div className={`p-4 rounded-2xl text-xs font-medium border ${
                refundMsg.error ? "bg-rose-500/10 border-rose-500/30 text-rose-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              }`}>
                {refundMsg.text}
              </div>
            )}

            {/* Manual Refund Form */}
            <div className="rounded-3xl border border-white/10 bg-[#15191e] p-6 shadow-xl">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white mb-4">Issue Cashfree Refund</h3>
              <form onSubmit={handleManualRefund} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">ORDER REFERENCE</label>
                  <input
                    type="text"
                    placeholder="PB-2026-00142"
                    value={manualRefund.orderId}
                    onChange={(e) => setManualRefund({ ...manualRefund, orderId: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-amber-400 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">AMOUNT (₹) (Optional - defaults to full)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Auto calculate"
                    value={manualRefund.amount}
                    onChange={(e) => setManualRefund({ ...manualRefund, amount: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-amber-400 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">REASON</label>
                  <input
                    type="text"
                    placeholder="Printer jam / Kiosk offline"
                    value={manualRefund.reason}
                    onChange={(e) => setManualRefund({ ...manualRefund, reason: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-amber-400 outline-none"
                  />
                </div>

                <div>
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition"
                  >
                    Execute Refund
                  </button>
                </div>
              </form>
            </div>

            {/* Refunds Ledger */}
            <div className="rounded-3xl border border-white/10 bg-[#15191e] overflow-hidden shadow-xl">
              <div className="p-6 border-b border-white/10">
                <h3 className="text-sm font-bold text-white">Refund Transaction History</h3>
                <p className="text-xs text-[#8a929e] mt-0.5">Authoritative Cashfree refund records</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/5 bg-black/20 text-[#8a929e] uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="py-3 px-6">Refund ID</th>
                      <th className="py-3 px-6">Order ID</th>
                      <th className="py-3 px-6">Status</th>
                      <th className="py-3 px-6">Requested</th>
                      <th className="py-3 px-6">Completed</th>
                      <th className="py-3 px-6">Reason</th>
                      <th className="py-3 px-6">Initiated By</th>
                      <th className="py-3 px-6">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[#d0d6e0]">
                    {refundLoading ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#8a929e]">Loading refunds...</td>
                      </tr>
                    ) : refunds.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#8a929e]">No refund records found.</td>
                      </tr>
                    ) : (
                      refunds.map((r) => (
                        <tr key={r.id} className="hover:bg-white/[0.02] transition">
                          <td className="py-4 px-6 font-mono text-white/90">
                            {r.cashfreeRefundId || `rf_local_${r.id}`}
                          </td>
                          <td className="py-4 px-6 font-mono font-semibold text-white">
                            {r.orderId}
                          </td>
                          <td className="py-4 px-6">
                            {getRefundBadge(r.status)}
                          </td>
                          <td className="py-4 px-6 font-semibold text-white">
                            {rupees(r.requestedAmount)}
                          </td>
                          <td className="py-4 px-6 font-semibold text-emerald-400">
                            {r.completedAmount ? rupees(r.completedAmount) : "—"}
                          </td>
                          <td className="py-4 px-6 text-[#8a929e] max-w-xs truncate" title={r.reason || ""}>
                            {r.reason || "—"}
                          </td>
                          <td className="py-4 px-6 text-[#8a929e]">
                            {r.initiatedBy}
                          </td>
                          <td className="py-4 px-6 text-[#8a929e]">
                            {new Date(r.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: PRICING & HARDWARE                                                 */}
        {/* ========================================================================= */}
        {activeTab === "pricing" && (
          <div className="space-y-6">
            {/* Hardware Telemetry Section */}
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
                <div className="rounded-2xl border border-white/5 bg-black/20 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-white">Kyocera ECOSYS PA3500x</h3>
                      <p className="text-xs text-[#8a929e]">Primary High-Speed B&W Laser</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      (primaryDevice.kyoceraPaper ?? 0) > 0 && primaryDevice.kyoceraReady !== false
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {(primaryDevice.kyoceraPaper ?? 0) <= 0 ? "Out of Paper" : primaryDevice.kyoceraReady !== false ? "Ready · 35 ppm" : "Fault / Offline"}
                    </span>
                  </div>

                  {/* Paper Tracking Meter */}
                  <div className="pt-2 border-t border-white/5 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8a929e]">A4 Tray 1 Level:</span>
                      <span className="font-bold text-white font-mono">{primaryDevice.kyoceraPaper ?? 250} sheets</span>
                    </div>
                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${(primaryDevice.kyoceraPaper ?? 0) > 50 ? "bg-amber-400" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(100, Math.round(((primaryDevice.kyoceraPaper ?? 250) / 500) * 100))}%` }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={refillingPaper === "kyocera"}
                    onClick={() => handleRefillPaper("kyocera")}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 py-2.5 text-xs font-bold text-amber-400 transition disabled:opacity-50"
                  >
                    {refillingPaper === "kyocera" ? "Refilling..." : "+ Refill 250 Sheets (Tray 1)"}
                  </button>
                </div>

                {/* Canon Primary Color & Fallback */}
                <div className="rounded-2xl border border-white/5 bg-black/20 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-white">Canon MAXIFY GX6170</h3>
                      <p className="text-xs text-[#8a929e]">Colour Pigment Ink &amp; Auto-B&amp;W Fallback</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      (primaryDevice.canonPaper ?? 0) > 0 && primaryDevice.canonReady !== false
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {(primaryDevice.canonPaper ?? 0) <= 0 ? "Out of Paper" : primaryDevice.canonReady !== false ? "Ready · Failover Enabled" : "Fault / Offline"}
                    </span>
                  </div>

                  {/* Paper Tracking Meter */}
                  <div className="pt-2 border-t border-white/5 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8a929e]">Cassette 1 Level:</span>
                      <span className="font-bold text-white font-mono">{primaryDevice.canonPaper ?? 250} sheets</span>
                    </div>
                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${(primaryDevice.canonPaper ?? 0) > 50 ? "bg-amber-400" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(100, Math.round(((primaryDevice.canonPaper ?? 250) / 500) * 100))}%` }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={refillingPaper === "canon"}
                    onClick={() => handleRefillPaper("canon")}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 py-2.5 text-xs font-bold text-amber-400 transition disabled:opacity-50"
                  >
                    {refillingPaper === "canon" ? "Refilling..." : "+ Refill 250 Sheets (Cassette 1)"}
                  </button>
                </div>
              </div>
            </section>

            {/* Dynamic Pricing Engine Form */}
            <section className="rounded-3xl border border-white/10 bg-[#15191e] p-6 shadow-xl">
              <h2 className="text-lg font-bold text-white">Dynamic Pricing Engine</h2>
              <p className="text-xs text-[#8a929e] mt-0.5">
                Configured rates apply to all new kiosk checkout orders immediately without requiring service restart.
              </p>

              {pricingMsg && (
                <div className={`mt-4 p-4 rounded-2xl text-xs font-medium border ${
                  pricingMsg.error ? "bg-rose-500/10 border-rose-500/30 text-rose-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                }`}>
                  {pricingMsg.text}
                </div>
              )}

              <form onSubmit={handleSavePricing} className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">BLACK &amp; WHITE RATE (₹/sheet)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pricing.bwPerPage}
                    onChange={(e) => setPricing({ ...pricing, bwPerPage: parseInt(e.target.value, 10) || 1 })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-[#8a929e]">Default university base: ₹2</p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">COLOUR RATE (₹/sheet)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pricing.colorPerPage}
                    onChange={(e) => setPricing({ ...pricing, colorPerPage: parseInt(e.target.value, 10) || 1 })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-[#8a929e]">Default university base: ₹8</p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">BILLING BASIS</label>
                  <select
                    value={pricing.billingBasis}
                    onChange={(e) => setPricing({ ...pricing, billingBasis: e.target.value as any })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 outline-none"
                  >
                    <option value="per_sheet">Per Physical Sheet (N-up Discount)</option>
                    <option value="per_side">Per Logical Page / Side</option>
                  </select>
                  <p className="mt-1 text-[11px] text-[#8a929e]">Student-first multi-page savings</p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8a929e] mb-1">MINIMUM ORDER (₹)</label>
                  <input
                    type="number"
                    min="1"
                    value={pricing.minOrderAmount}
                    onChange={(e) => setPricing({ ...pricing, minOrderAmount: parseInt(e.target.value, 10) || 1 })}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 outline-none"
                  />
                  <p className="mt-1 text-[11px] text-[#8a929e]">Base floor transaction</p>
                </div>

                <div className="sm:col-span-2 lg:col-span-4 mt-2">
                  <button
                    type="submit"
                    disabled={savingPricing}
                    className="rounded-xl bg-amber-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition disabled:opacity-50"
                  >
                    {savingPricing ? "Saving Rates..." : "Save Pricing Configuration to Production Database"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: RECONCILIATION & CLEANUP                                           */}
        {/* ========================================================================= */}
        {activeTab === "reconciliation" && (
          <div className="space-y-6">
            {/* Reconciliation Worker Card */}
            <div className="rounded-3xl border border-white/10 bg-[#15191e] p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-lg font-bold text-white">Payment Reconciliation Engine</h2>
                  <p className="text-xs text-[#8a929e] mt-0.5">
                    Automatically verifies unconfirmed orders directly against Cashfree official records to recover dropped sessions.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={runningReconciliation}
                  onClick={handleRunReconciliation}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition disabled:opacity-50"
                >
                  {runningReconciliation ? "Reconciling..." : "Run Cashfree Reconciliation"}
                </button>
              </div>

              {reconcileResult && (
                <div className="rounded-2xl border border-white/5 bg-black/30 p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between font-semibold text-white">
                    <span>Reconciliation Results</span>
                    <span>Checked: {reconcileResult.totalChecked ?? 0} | Reconciled: {reconcileResult.totalReconciled ?? 0}</span>
                  </div>

                  {reconcileResult.results && reconcileResult.results.length > 0 ? (
                    <div className="divide-y divide-white/5 pt-2">
                      {reconcileResult.results.map((r: any, idx: number) => (
                        <div key={idx} className="py-2 flex items-center justify-between">
                          <span className="font-mono text-white/90">{r.orderId}</span>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            r.status === "reconciled" ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-[#8a929e]"
                          }`}>
                            {r.status}: {r.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[#8a929e] pt-1">All orders are fully reconciled. No pending discrepancies found.</p>
                  )}
                </div>
              )}
            </div>

            {/* Privacy Shredding & Document Cleanup */}
            <div className="rounded-3xl border border-white/10 bg-[#15191e] p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-lg font-bold text-white">Privacy Shredding &amp; Storage Hygiene</h2>
                  <p className="text-xs text-[#8a929e] mt-0.5">
                    Customer documents are automatically purged on print completion. Run a manual sweep to purge any abandoned uploads older than 24h.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={cleaningStorage}
                  onClick={handleStorageCleanup}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                >
                  {cleaningStorage ? "Purging..." : "Purge Expired Storage Files"}
                </button>
              </div>

              {cleanupResult && (
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs font-mono text-emerald-400">
                  {cleanupResult}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
