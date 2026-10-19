import type { Usage } from "../api/admin";
export const formatNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
export const formatCost = (value: number) => `$${value.toFixed(value < 0.01 && value > 0 ? 5 : 3)}`;
export const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
export function UsageStats({ usage, sessionCount }: { usage: Usage; sessionCount?: number }) {
  const metrics = [
    { label: "Total Tokens", value: formatNumber(usage.totalTokens) },
    { label: "Input", value: formatNumber(usage.input) },
    { label: "Output", value: formatNumber(usage.output) },
    { label: "Cache Read", value: formatNumber(usage.cacheRead) },
    { label: "Cache Write", value: formatNumber(usage.cacheWrite) },
    { label: "Estimated Cost", value: formatCost(usage.estimatedCost) },
  ];
  return <div className="metrics">{metrics.map(item => <div className="metric" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}
    {sessionCount !== undefined && <div className="metric"><span>会话数</span><strong>{formatNumber(sessionCount)}</strong></div>}
  </div>;
}
