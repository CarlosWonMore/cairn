import { CairnDb } from './db.js';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { sha256Hex } from '../core/hash.js';
import { WriteGuardMixin } from './write-guard.js';

/**
 * 导入档案仓储（任务 4.2）：不可变快照的元数据与条目。
 * 快照文件本身由 onboarding 快照层写入 dataDir/snapshots/；
 * 本仓储只负责幂等登记与条目索引。
 */

export type ImportSourceKind = 'markdown' | 'jsonl' | 'agent_memory_file' | 'manual_export';
export type ImportArchiveStatus = 'stored' | 'partially_indexed' | 'indexed' | 'rejected' | 'quarantined';
export type RedactionState = 'not_scanned' | 'scanned_clean' | 'scanned_blocked';

export interface ImportArchiveRow {
  id: string;
  batchId: string;
  sourceKind: ImportSourceKind;
  sourceLocatorHash: string;
  sourceLabel: string | null;
  byteSize: number;
  contentHash: string;
  snapshotPath: string;
  parser: string;
  status: ImportArchiveStatus;
  redactionState: RedactionState;
  discoveredAt: string;
  importedAt: string | null;
}

export interface CreateArchiveInput {
  batchId: string;
  sourceKind: ImportSourceKind;
  /** 来源定位串（路径 + 关键元数据）；只存哈希，不存原始路径以外的敏感信息。 */
  sourceLocator: string;
  sourceLabel?: string;
  byteSize: number;
  contentHash: string;
  snapshotPath: string;
  parser: string;
}

export interface ImportItemRow {
  id: string;
  archiveId: string;
  itemIndex: number;
  content: string;
  contentHash: string;
  byteOffset: number | null;
  sourceRef: string | null;
  scanState: 'pending' | 'clean' | 'blocked';
  scanFindings: string | null;
  batchId: string | null;
  createdAt: string;
}

export class ImportArchiveRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  /**
   * 幂等创建：同一 (来源定位哈希, 内容哈希) 重复导入零新增，
   * 返回 created=false 复用已有档案（spec agent-onboarding：重复导入）。
   */
  createArchive(input: CreateArchiveInput): { archive: ImportArchiveRow; created: boolean } {
    this.checkWritable();
    const locatorHash = sha256Hex(input.sourceLocator);
    const existing = this.db.get(
      'SELECT * FROM import_archive WHERE source_locator_hash = ? AND content_hash = ?',
      locatorHash,
      input.contentHash,
    );
    if (existing) return { archive: mapArchive(existing), created: false };
    const id = uuidv7();
    this.db.run(
      `INSERT INTO import_archive (id, batch_id, source_kind, source_locator_hash, source_label, byte_size,
         content_hash, snapshot_path, parser, status, redaction_state, discovered_at, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'stored', 'not_scanned', ?, ?)`,
      id,
      input.batchId,
      input.sourceKind,
      locatorHash,
      input.sourceLabel ?? null,
      input.byteSize,
      input.contentHash,
      input.snapshotPath,
      input.parser,
      nowIso(),
      nowIso(),
    );
    return { archive: this.requireById(id), created: true };
  }

  requireById(id: string): ImportArchiveRow {
    const row = this.db.get('SELECT * FROM import_archive WHERE id = ?', id);
    if (!row) throw err('E_NOT_FOUND', `导入档案不存在: ${id}`);
    return mapArchive(row);
  }

  findById(id: string): ImportArchiveRow | null {
    const row = this.db.get('SELECT * FROM import_archive WHERE id = ?', id);
    return row ? mapArchive(row) : null;
  }

  listByBatch(batchId: string): ImportArchiveRow[] {
    return this.db.all('SELECT * FROM import_archive WHERE batch_id = ? ORDER BY discovered_at, id', batchId).map(mapArchive);
  }

  list(): ImportArchiveRow[] {
    return this.db.all('SELECT * FROM import_archive ORDER BY discovered_at DESC, id').map(mapArchive);
  }

  setStatus(id: string, status: ImportArchiveStatus): void {
    this.db.run('UPDATE import_archive SET status = ? WHERE id = ?', status, id);
  }

  setRedactionState(id: string, state: RedactionState): void {
    this.db.run('UPDATE import_archive SET redaction_state = ? WHERE id = ?', state, id);
  }

  /** 条目登记：archive 内按 index 幂等。 */
  addItem(input: {
    archiveId: string;
    itemIndex: number;
    content: string;
    byteOffset?: number;
    sourceRef?: string;
    scanState?: 'pending' | 'clean' | 'blocked';
    scanFindings?: string;
    batchId?: string;
  }): { item: ImportItemRow; created: boolean } {
    this.checkWritable();
    const existing = this.db.get('SELECT * FROM import_item WHERE archive_id = ? AND item_index = ?', input.archiveId, input.itemIndex);
    if (existing) return { item: mapItem(existing), created: false };
    const id = uuidv7();
    this.db.run(
      `INSERT INTO import_item (id, archive_id, item_index, content, content_hash, byte_offset, source_ref,
         scan_state, scan_findings, batch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.archiveId,
      input.itemIndex,
      input.content,
      sha256Hex(input.content),
      input.byteOffset ?? null,
      input.sourceRef ?? null,
      input.scanState ?? 'pending',
      input.scanFindings ?? null,
      input.batchId ?? null,
      nowIso(),
    );
    this.db.run("UPDATE import_archive SET status = 'partially_indexed' WHERE id = ? AND status = 'stored'", input.archiveId);
    return { item: this.requireItem(id), created: true };
  }

  requireItem(id: string): ImportItemRow {
    const row = this.db.get('SELECT * FROM import_item WHERE id = ?', id);
    if (!row) throw err('E_NOT_FOUND', `导入条目不存在: ${id}`);
    return mapItem(row);
  }

  listItems(archiveId: string, filter: { batchId?: string; scanState?: ImportItemRow['scanState'] } = {}): ImportItemRow[] {
    const where = ['archive_id = ?'];
    const params: unknown[] = [archiveId];
    if (filter.batchId) {
      where.push('batch_id = ?');
      params.push(filter.batchId);
    }
    if (filter.scanState) {
      where.push('scan_state = ?');
      params.push(filter.scanState);
    }
    return this.db
      .all(`SELECT * FROM import_item WHERE ${where.join(' AND ')} ORDER BY item_index`, ...params)
      .map(mapItem);
  }

  /** 分批取件：按批次取待处理条目，供 onboarding 分批读取（任务 4.3）。 */
  nextBatch(batchId: string, limit: number, states: ImportItemRow['scanState'][] = ['clean']): ImportItemRow[] {
    const placeholders = states.map(() => '?').join(',');
    return this.db
      .all(
        `SELECT * FROM import_item WHERE batch_id = ? AND scan_state IN (${placeholders}) ORDER BY archive_id, item_index LIMIT ?`,
        batchId,
        ...states,
        limit,
      )
      .map(mapItem);
  }

  updateItemState(id: string, scanState: ImportItemRow['scanState'], scanFindings?: string, batchId?: string): void {
    this.checkWritable();
    this.db.run('UPDATE import_item SET scan_state = ?, scan_findings = IFNULL(?, scan_findings), batch_id = IFNULL(?, batch_id) WHERE id = ?', scanState, scanFindings ?? null, batchId ?? null, id);
  }

  counts(): { archives: number; items: number; blockedItems: number } {
    return {
      archives: Number(this.db.scalar('SELECT COUNT(*) AS n FROM import_archive') ?? 0),
      items: Number(this.db.scalar('SELECT COUNT(*) AS n FROM import_item') ?? 0),
      blockedItems: Number(this.db.scalar("SELECT COUNT(*) AS n FROM import_item WHERE scan_state = 'blocked'") ?? 0),
    };
  }
}

function mapArchive(r: Record<string, unknown>): ImportArchiveRow {
  return {
    id: r.id as string,
    batchId: r.batch_id as string,
    sourceKind: r.source_kind as ImportSourceKind,
    sourceLocatorHash: r.source_locator_hash as string,
    sourceLabel: (r.source_label as string | null) ?? null,
    byteSize: Number(r.byte_size),
    contentHash: r.content_hash as string,
    snapshotPath: r.snapshot_path as string,
    parser: r.parser as string,
    status: r.status as ImportArchiveStatus,
    redactionState: r.redaction_state as RedactionState,
    discoveredAt: r.discovered_at as string,
    importedAt: (r.imported_at as string | null) ?? null,
  };
}

function mapItem(r: Record<string, unknown>): ImportItemRow {
  return {
    id: r.id as string,
    archiveId: r.archive_id as string,
    itemIndex: Number(r.item_index),
    content: r.content as string,
    contentHash: r.content_hash as string,
    byteOffset: (r.byte_offset as number | null) ?? null,
    sourceRef: (r.source_ref as string | null) ?? null,
    scanState: r.scan_state as ImportItemRow['scanState'],
    scanFindings: (r.scan_findings as string | null) ?? null,
    batchId: (r.batch_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}
