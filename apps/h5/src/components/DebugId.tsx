import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Debug identifiers are metadata; they never grant access to the referenced resource. */
export function DebugId({ label, value }: { label: string; value: string | null }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const copied = value !== null && copiedValue === value;
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setError(false);
    } catch { setError(true); }
  };
  return <div className="debug-id">
    <span className="debug-id-label">{label}</span>
    <code>{value ?? "尚未绑定"}</code>
    {value && <button type="button" onClick={() => void copy()} aria-label={`复制 ${label}`} title={`复制 ${label}`}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>}
    <span className="debug-id-feedback" role="status">{error ? "复制失败，请手动选择" : copied ? "已复制" : ""}</span>
  </div>;
}
