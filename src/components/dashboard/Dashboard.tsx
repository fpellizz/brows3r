import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Cloud,
  Database as DatabaseIcon,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { tauriInvoke } from "@/lib/tauri";
import { useUiStore } from "@/stores/uiStore";
import { useConnectionStore } from "@/stores/connectionStore";

interface BucketInfo {
  name: string;
  creation_date: string | null;
  region: string | null;
}
interface StorageClassBreakdown {
  storage_class: string;
  count: number;
  total_bytes: number;
}
interface BucketStats {
  object_count: number;
  total_bytes: number;
  by_storage_class: StorageClassBreakdown[];
  truncated: boolean;
}
interface TransferHistoryEntry {
  id: string;
  transfer_type: "upload" | "download";
  connection_id: string;
  bucket: string;
  key: string;
  total_bytes: number;
  status: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

const STORAGE_CLASS_COLORS: Record<string, string> = {
  STANDARD: "#3b82f6",
  STANDARD_IA: "#8b5cf6",
  ONEZONE_IA: "#a855f7",
  INTELLIGENT_TIERING: "#06b6d4",
  GLACIER_IR: "#0ea5e9",
  GLACIER: "#14b8a6",
  DEEP_ARCHIVE: "#22c55e",
  REDUCED_REDUNDANCY: "#f59e0b",
};
const DEFAULT_COLOR = "#64748b";

const colorFor = (sc: string) => STORAGE_CLASS_COLORS[sc] ?? DEFAULT_COLOR;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function Dashboard() {
  const { t } = useTranslation();
  const toggle = useUiStore((s) => s.toggleDashboard);
  const connections = useConnectionStore((s) => s.connections);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );

  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, BucketStats>>({});
  const [computing, setComputing] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<TransferHistoryEntry[]>([]);

  const refreshAll = async () => {
    setBucketsError(null);
    setBucketsLoading(true);
    try {
      if (activeConnectionId) {
        const result = await tauriInvoke<BucketInfo[]>("list_buckets", {
          connectionId: activeConnectionId,
        });
        setBuckets(result);
      } else {
        setBuckets([]);
      }
      const h = await tauriInvoke<TransferHistoryEntry[]>("list_transfer_history");
      setHistory(h);
    } catch (e) {
      setBucketsError(String(e));
    } finally {
      setBucketsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  const computeStats = async (bucket: string) => {
    if (!activeConnectionId || computing.has(bucket)) return;
    setComputing((prev) => new Set(prev).add(bucket));
    try {
      const result = await tauriInvoke<BucketStats>("compute_bucket_stats", {
        connectionId: activeConnectionId,
        bucket,
      });
      setStats((prev) => ({ ...prev, [bucket]: result }));
    } catch (e) {
      console.error("compute_bucket_stats failed:", e);
    } finally {
      setComputing((prev) => {
        const next = new Set(prev);
        next.delete(bucket);
        return next;
      });
    }
  };

  // Aggregate KPIs
  const totalBytes = useMemo(
    () => Object.values(stats).reduce((sum, s) => sum + s.total_bytes, 0),
    [stats],
  );
  const totalObjects = useMemo(
    () => Object.values(stats).reduce((sum, s) => sum + s.object_count, 0),
    [stats],
  );

  // Storage-class breakdown (sum across all computed buckets)
  const classBreakdown = useMemo(() => {
    const acc = new Map<string, { count: number; bytes: number }>();
    for (const s of Object.values(stats)) {
      for (const c of s.by_storage_class) {
        const cur = acc.get(c.storage_class) ?? { count: 0, bytes: 0 };
        cur.count += c.count;
        cur.bytes += c.total_bytes;
        acc.set(c.storage_class, cur);
      }
    }
    return [...acc.entries()]
      .map(([sc, v]) => ({ storage_class: sc, ...v }))
      .sort((a, b) => b.bytes - a.bytes);
  }, [stats]);

  // Top-N buckets by size
  const topBuckets = useMemo(() => {
    return Object.entries(stats)
      .map(([bucket, s]) => ({ bucket, bytes: s.total_bytes, objects: s.object_count }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8);
  }, [stats]);

  // Transfer aggregates
  const txDone = history.length;
  const txSuccess = history.filter((h) => h.status === "Completed" || h.status === "completed").length;
  const txFailed = history.filter((h) => h.status === "Failed" || h.status === "failed").length;
  const successRate = txDone > 0 ? Math.round((txSuccess / txDone) * 100) : 0;

  // Per-day transfer counts (last 30 days, used by the sparkline)
  const sparkData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: { date: Date; count: number; bytes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push({ date: d, count: 0, bytes: 0 });
    }
    for (const h of history) {
      const d = new Date(h.created_at);
      d.setHours(0, 0, 0, 0);
      const idx = days.findIndex((x) => x.date.getTime() === d.getTime());
      if (idx >= 0) {
        days[idx].count += 1;
        days[idx].bytes += h.total_bytes ?? 0;
      }
    }
    return days;
  }, [history]);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-zinc-50 via-zinc-50 to-zinc-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-md bg-white/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-0.5">
              <Sparkles size={12} />
              {t("dashboard.eyebrow")}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {activeConnection?.name ?? t("dashboard.noConnection")}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={refreshAll}
              disabled={bucketsLoading}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
              title={t("common.refresh")}
            >
              <RefreshCw size={16} className={bucketsLoading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={toggle}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title={t("common.close")}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label={t("dashboard.kpi.connections")}
            value={formatNumber(connections.length)}
            icon={<Cloud size={18} />}
            gradient="from-sky-500 to-blue-600"
          />
          <KpiCard
            label={t("dashboard.kpi.buckets")}
            value={formatNumber(buckets.length)}
            sub={activeConnection ? activeConnection.name : ""}
            icon={<Boxes size={18} />}
            gradient="from-violet-500 to-fuchsia-600"
          />
          <KpiCard
            label={t("dashboard.kpi.transfers")}
            value={formatNumber(txDone)}
            sub={
              txDone > 0
                ? `${txSuccess} ${t("dashboard.kpi.ok")} · ${txFailed} ${t("dashboard.kpi.fail")}`
                : ""
            }
            icon={<TrendingUp size={18} />}
            gradient="from-emerald-500 to-teal-600"
          />
          <KpiCard
            label={t("dashboard.kpi.successRate")}
            value={`${successRate}%`}
            sub={txDone === 0 ? t("dashboard.kpi.noData") : ""}
            icon={<CheckCircle2 size={18} />}
            gradient={successRate >= 90 ? "from-emerald-500 to-green-600" : "from-amber-500 to-orange-600"}
          />
        </div>

        {/* Aggregated storage row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader
              title={t("dashboard.storageBreakdown")}
              subtitle={
                Object.keys(stats).length === 0
                  ? t("dashboard.storageBreakdownEmpty")
                  : t("dashboard.aggregatedAcross", { count: Object.keys(stats).length })
              }
              icon={<DatabaseIcon size={14} className="text-violet-500" />}
            />
            {classBreakdown.length === 0 ? (
              <div className="text-xs text-zinc-500 py-6 text-center">
                {t("dashboard.storageBreakdownHint")}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <DonutChart data={classBreakdown.map((c) => ({ label: c.storage_class, value: c.bytes, color: colorFor(c.storage_class) }))} />
                <div className="flex-1 space-y-1.5 text-xs">
                  {classBreakdown.map((c) => (
                    <div key={c.storage_class} className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: colorFor(c.storage_class) }}
                      />
                      <span className="font-mono truncate flex-1 text-zinc-600 dark:text-zinc-400">
                        {c.storage_class}
                      </span>
                      <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                        {formatBytes(c.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title={t("dashboard.topBuckets")}
              subtitle={
                topBuckets.length === 0
                  ? t("dashboard.topBucketsEmpty")
                  : `${formatBytes(totalBytes)} · ${formatNumber(totalObjects)} ${t("dashboard.objects")}`
              }
              icon={<Boxes size={14} className="text-fuchsia-500" />}
            />
            {topBuckets.length === 0 ? (
              <div className="text-xs text-zinc-500 py-6 text-center">
                {t("dashboard.topBucketsHint")}
              </div>
            ) : (
              <BarList
                items={topBuckets.map((b) => ({
                  label: b.bucket,
                  value: b.bytes,
                  display: `${formatBytes(b.bytes)} · ${formatNumber(b.objects)} obj`,
                }))}
              />
            )}
          </Card>
        </div>

        {/* Transfer activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader
              title={t("dashboard.transferActivity")}
              subtitle={t("dashboard.last30Days")}
              icon={<TrendingUp size={14} className="text-emerald-500" />}
            />
            <Sparkline data={sparkData} />
          </Card>

          <Card>
            <CardHeader
              title={t("dashboard.recentTransfers")}
              subtitle=""
              icon={<ArrowUpRight size={14} className="text-sky-500" />}
            />
            <ActivityFeed entries={history.slice(0, 8)} />
          </Card>
        </div>

        {/* Buckets list with on-demand stats */}
        <Card>
          <CardHeader
            title={t("dashboard.bucketsTitle")}
            subtitle={
              activeConnection
                ? t("dashboard.bucketsSubtitle", { name: activeConnection.name })
                : t("dashboard.noConnection")
            }
            icon={<Cloud size={14} className="text-blue-500" />}
          />
          {bucketsError && (
            <div className="text-xs text-red-600 dark:text-red-400 mb-2">{bucketsError}</div>
          )}
          {buckets.length === 0 ? (
            <div className="text-xs text-zinc-500 py-6 text-center">
              {bucketsLoading
                ? t("dashboard.bucketsLoading")
                : activeConnection
                  ? t("dashboard.bucketsEmpty")
                  : t("dashboard.bucketsNoConnection")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {buckets.map((b) => (
                <BucketCard
                  key={b.name}
                  bucket={b}
                  stats={stats[b.name]}
                  computing={computing.has(b.name)}
                  onCompute={() => computeStats(b.name)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ===========================================================================
// Sub-components
// ===========================================================================

function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "relative rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm hover:shadow-md transition-shadow " +
        (className ?? "")
      }
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          {icon}
          {title}
        </div>
        {subtitle && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  gradient,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all">
      {/* Subtle gradient on hover */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity`}
      />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
            {label}
          </span>
          <span
            className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient} text-white flex items-center justify-center shadow-sm`}
          >
            {icon}
          </span>
        </div>
        <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
          {value}
        </div>
        {sub && (
          <div className="text-[11px] text-zinc-500 mt-1 truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}

function DonutChart({
  data,
}: {
  data: { label: string; value: number; color: string }[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;
  const arcs = data.map((d, i) => {
    const frac = total > 0 ? d.value / total : 0;
    const length = frac * circumference;
    const offset = circumference - length - cumulative;
    cumulative += length;
    return (
      <circle
        key={i}
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke={d.color}
        strokeWidth="12"
        strokeDasharray={`${length} ${circumference}`}
        strokeDashoffset={offset}
        transform="rotate(-90 60 60)"
        className="transition-all duration-500"
      />
    );
  });

  return (
    <div className="relative shrink-0">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          className="text-zinc-100 dark:text-zinc-800"
        />
        {arcs}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
          {formatBytes(total)}
        </div>
        <div className="text-[10px] text-zinc-500">{data.length} classes</div>
      </div>
    </div>
  );
}

function BarList({ items }: { items: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const pct = (it.value / max) * 100;
        return (
          <div key={i} className="text-xs">
            <div className="flex items-baseline justify-between mb-0.5">
              <span className="font-mono truncate text-zinc-700 dark:text-zinc-300">{it.label}</span>
              <span className="text-zinc-500 shrink-0 ml-2">{it.display}</span>
            </div>
            <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({
  data,
}: {
  data: { date: Date; count: number; bytes: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 100;
  const height = 30;
  const stepX = width / Math.max(1, data.length - 1);
  // SVG path
  const pts = data.map((d, i) => ({
    x: i * stepX,
    y: height - (d.count / max) * height,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
          {total.toLocaleString()}
        </span>
        <span className="text-[11px] text-zinc-500">transfers</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-24"
      >
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkGrad)" />
        <path
          d={linePath}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
        <span>{data[0]?.date.toLocaleDateString()}</span>
        <span>{data[data.length - 1]?.date.toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function ActivityFeed({ entries }: { entries: TransferHistoryEntry[] }) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <div className="text-xs text-zinc-500 py-6 text-center">
        {t("dashboard.noActivity")}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 max-h-56 overflow-y-auto -mr-2 pr-2">
      {entries.map((e) => {
        const ok = e.status === "Completed" || e.status === "completed";
        return (
          <div
            key={e.id}
            className="flex items-center gap-2 text-xs py-1 px-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          >
            <span
              className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                ok ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
              }`}
            >
              {e.transfer_type === "upload" ? <Upload size={12} /> : <Download size={12} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-mono truncate text-zinc-700 dark:text-zinc-300">{e.key}</div>
              <div className="text-[10px] text-zinc-500">
                {e.bucket} · {formatBytes(e.total_bytes)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BucketCard({
  bucket,
  stats,
  computing,
  onCompute,
}: {
  bucket: BucketInfo;
  stats?: BucketStats;
  computing: boolean;
  onCompute: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/60 dark:bg-zinc-900/60 p-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <Boxes size={14} className="text-fuchsia-500 shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{bucket.name}</span>
      </div>
      {stats ? (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-500">{t("dashboard.bucketSize")}</span>
            <span className="font-mono text-zinc-900 dark:text-zinc-100 tabular-nums">
              {formatBytes(stats.total_bytes)}
              {stats.truncated && "+"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">{t("dashboard.bucketObjects")}</span>
            <span className="font-mono text-zinc-900 dark:text-zinc-100 tabular-nums">
              {formatNumber(stats.object_count)}
              {stats.truncated && "+"}
            </span>
          </div>
          {stats.truncated && (
            <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
              {t("dashboard.truncatedHint")}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onCompute}
          disabled={computing}
          className="w-full mt-1 px-2 py-1.5 text-xs rounded-md bg-gradient-to-r from-brand-500 to-violet-500 text-white hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-sm"
        >
          {computing ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {t("dashboard.computing")}
            </>
          ) : (
            <>
              <TrendingUp size={12} />
              {t("dashboard.computeStats")}
            </>
          )}
        </button>
      )}
    </div>
  );
}
