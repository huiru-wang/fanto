import { useRouter } from '../../lib/router';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { RecordReadDto } from '@fanto/shared';
import { Layout, Loading, ErrorNotice, back } from '../../components/layout';
import { updateRecord, useRecord } from '../../lib/api';

function Editor({ record }: { record: RecordReadDto }) {
  const [text, setText] = useState(record.content.text); const [saving, setSaving] = useState(false); const [error, setError] = useState<Error | null>(null); const lock = useRef(false); const client = useQueryClient();
  async function save() { if (lock.current || (!text.trim() && record.content.blocks.length === 0)) return; if (text === record.content.text) return back('records'); lock.current = true; setSaving(true); setError(null); try { await updateRecord(record.id, text, record); await client.invalidateQueries({ queryKey: ['records'] }); back('records'); } catch (cause) { setError(cause as Error); } finally { lock.current = false; setSaving(false); } }
  return <><textarea aria-label="编辑原始记录" className="edit-input" value={text} disabled={saving} onChange={event => setText(event.target.value)} /><ErrorNotice error={error} /><div className="edit-actions"><button className="secondary" disabled={saving} onClick={() => back('records')}>取消</button><button className="primary" disabled={saving || (!text.trim() && record.content.blocks.length === 0)} onClick={save}><Check size={17} />{saving ? '保存中…' : '保存'}</button></div></>;
}
export default function RecordEdit() { const query = useRecord(useRouter().params.id || ''); return <Layout active="records" title="编辑记录" detail><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : query.data && <Editor record={query.data} />}</Layout>; }
