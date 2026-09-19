import { ArrowDown, Clock3, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRecord, listRecords, searchRecords, type RecordItem } from "../api/records";
import { RecordComposer } from "../components/RecordComposer";
import { RecordMediaList } from "../components/RecordMedia";

const statusText: Record<RecordItem["status"], string> = {
  pending: "等待整理",
  updated: "等待整理",
  processing: "正在理解",
  processed: "已整理",
};

function dateKey(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
    .format(new Date(value));
}

function timeText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(value));
}

export function RecordsPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RecordItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listRecords();
      setRecords(page.data);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取记录");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void (async () => {
        try {
          const hits = await searchRecords(keyword);
          const recordIds = [...new Set(hits.map(hit => hit.recordId))];
          const loaded = new Map(records.map(record => [record.id, record]));
          const results = await Promise.all(recordIds.map(id => loaded.get(id) ?? getRecord(id)));
          if (!cancelled) {
            setSearchResults(results);
            setError(null);
          }
        } catch (cause) {
          if (!cancelled) {
            setSearchResults([]);
            setError(cause instanceof Error ? cause.message : "搜索没有完成");
          }
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, records]);

  const visibleRecords = query.trim() ? (searchResults ?? []) : records;

  const groups = useMemo(() => {
    const grouped = new Map<string, RecordItem[]>();
    for (const record of visibleRecords) {
      const key = dateKey(record.eventAt);
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }
    return [...grouped.entries()];
  }, [visibleRecords]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listRecords(nextCursor);
      setRecords(current => [...current, ...page.data]);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "没有加载成功");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page records-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">你的长期记忆</p>
          <h1>记录</h1>
          <p className="page-description">先把此刻留下来，整理可以慢一点发生。</p>
        </div>
        <button className="icon-button" onClick={() => void load()} aria-label="刷新记录" title="刷新">
          <RefreshCw size={18} />
        </button>
      </header>

      <RecordComposer onCreated={record => setRecords(current => [record, ...current])} />

      <div className="record-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索你的记录" />
        </div>
        <span className="record-count">{searching ? "搜索中…" : `${visibleRecords.length} 条`}</span>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="empty-state"><span className="large-loader" /><p>正在读取记录…</p></div>
      ) : searching ? (
        <div className="empty-state"><span className="large-loader" /><p>正在回想相关记录…</p></div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-orb"><Clock3 size={24} /></div>
          <h2>{query ? "没有找到相关记录" : "从第一条记录开始"}</h2>
          <p>{query ? "换个关键词试试。" : "不需要分类，也不用写完整。先留下就好。"}</p>
        </div>
      ) : (
        <div className="timeline">
          {groups.map(([date, items]) => (
            <section className="timeline-group" key={date}>
              <h2>{date}</h2>
              <div className="timeline-items">
                {items.map(record => (
                  <article className="record-row" key={record.id}>
                    <time>{timeText(record.eventAt)}</time>
                    <div className="timeline-node" />
                    <div className="record-content">
                      {record.content.text && <p>{record.content.text}</p>}
                      <RecordMediaList media={record.media ?? []} />
                      <div className="record-meta">
                        <span className={`record-status ${record.status}`}>{statusText[record.status]}</span>
                        {record.content.blocks.length > 0 && <span>{record.content.blocks.length} 个媒体</span>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}

          {!query.trim() && hasMore && (
            <button className="load-more" disabled={loadingMore} onClick={() => void loadMore()}>
              <ArrowDown size={16} />
              {loadingMore ? "加载中…" : "加载更早记录"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
