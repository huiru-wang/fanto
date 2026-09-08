import type { RecordReadDto } from '@fanto/shared';
import { formatTime } from '../lib/model';
import { go } from './layout';

export function RecordRow({ record }: { record: RecordReadDto }) {
  return <article className="record-row"><button className="record-content" onClick={() => go('record-detail', record.id)}>{record.content.text || '媒体记录'}</button><div className="record-meta"><time>{formatTime(record.createdAt)}</time></div></article>;
}

export function RelatedRecordRow({ record }: { record: RecordReadDto }) {
  return <article className="related-record-row"><time>{formatTime(record.createdAt)}</time><p>{record.content.text || '媒体记录'}</p></article>;
}
