import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RouteRef, RouteRefDocument, RouteSyncState, RouteSyncStateDocument } from './reference.schema';

export interface LegacyDocumentsReport {
  missingCount: number;
  nullCount: number;
  emptyCount: number;
  totalLegacyCount: number;
  unsetOnNullOrEmptyCount: number;
}

export interface IntendedIndexSpec {
  name: string;
  key: Record<string, number>;
  options?: {
    unique?: boolean;
    sparse?: boolean;
  };
}

export const INTENDED_ROUTEREF_INDEXES: IntendedIndexSpec[] = [
  {
    name: 'source_key_1',
    key: { source_key: 1 },
    options: { unique: true, sparse: true },
  },
  {
    name: 'dep_iata_1_arr_iata_1',
    key: { dep_iata: 1, arr_iata: 1 },
  },
  {
    name: 'dep_iata_1_synced_at_1',
    key: { dep_iata: 1, synced_at: 1 },
  },
  {
    name: 'dep_iata_1_sync_generation_1',
    key: { dep_iata: 1, sync_generation: 1 },
  },
];

export interface IndexMigrationResult {
  collectionExists: boolean;
  collectionCreated: boolean;
  obsoleteIndexDropped: boolean;
  droppedIndexName?: string;
  sourceKeyIndexCreated: boolean;
  sourceKeyIndexAlreadyExisted: boolean;
  sourceKeyIndexReplaced: boolean;
  createdIndexes: string[];
  missingSecondaryIndexesCreated: string[];
  legacyDocuments: LegacyDocumentsReport;
  unrelatedIndexesPreserved: string[];
}

/**
 * Predicate to identify ONLY the obsolete unique index whose key pattern exactly matches:
 * { airline_iata: 1, dep_iata: 1, arr_iata: 1 } and unique === true.
 * Unrelated indexes like _id_, { dep_iata: 1, arr_iata: 1 }, { dep_iata: 1, synced_at: 1 },
 * { dep_iata: 1, sync_generation: 1 }, { source_key: 1 } MUST NEVER match.
 */
export function isObsoleteRouteRefIndex(idx: { name?: string; key?: Record<string, any>; unique?: boolean; [k: string]: any }): boolean {
  if (!idx || !idx.key) return false;
  const keys = Object.keys(idx.key);
  if (keys.length !== 3) return false;

  const hasAirline = idx.key.airline_iata === 1;
  const hasDep = idx.key.dep_iata === 1;
  const hasArr = idx.key.arr_iata === 1;

  return Boolean(hasAirline && hasDep && hasArr && idx.unique === true);
}

/**
 * Predicate to check whether an index key is strictly and exclusively { source_key: 1 }.
 */
export function isExactSourceKeyIndex(idx: { name?: string; key?: Record<string, any>; [k: string]: any }): boolean {
  if (!idx || !idx.key) return false;
  const keys = Object.keys(idx.key);
  return keys.length === 1 && idx.key.source_key === 1;
}

/**
 * Predicate to check whether a source_key index has the exact intended options:
 * key = { source_key: 1 }, unique === true, sparse === true.
 */
export function isCorrectSourceKeyIndex(idx: { name?: string; key?: Record<string, any>; unique?: boolean; sparse?: boolean; [k: string]: any }): boolean {
  return isExactSourceKeyIndex(idx) && idx.unique === true && idx.sparse === true;
}

/**
 * Helper to check whether an existing index key pattern matches an intended key pattern.
 */
export function matchIndexKey(a: Record<string, any> = {}, b: Record<string, any> = {}): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => b[k] === a[k]);
}

@Injectable()
export class RouteIndexMigrationService implements OnModuleInit {
  private readonly logger = new Logger(RouteIndexMigrationService.name);

  constructor(
    @InjectModel(RouteRef.name) private routeRefModel: Model<RouteRefDocument>,
    @Optional() @InjectModel(RouteSyncState.name) private routeSyncStateModel?: Model<RouteSyncStateDocument>,
  ) {}

  /**
   * Automatically executes on application bootstrap.
   * Rethrows genuine migration failures to prevent running with invalid index configuration.
   */
  async onModuleInit() {
    try {
      await this.migrateIndexes();
      await this.migrateRouteSyncStateIndexes();
    } catch (err: any) {
      this.logger.error(`Critical Route / RouteSyncState index migration failure on startup: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Safely migrates RouteSyncState collection indexes:
   * Drops obsolete single-field unique index on dep_iata (dep_iata_1),
   * creates compound unique index { dep_iata: 1, source: 1 },
   * and verifies final collection index state.
   *
   * Re-throws genuine failures to onModuleInit() to abort startup on invalid index state.
   */
  async migrateRouteSyncStateIndexes(): Promise<void> {
    if (!this.routeSyncStateModel) return;

    const col = this.routeSyncStateModel.collection;
    let indexes: any[] = [];
    try {
      indexes = await col.indexes();
    } catch (err: any) {
      // Code 26: NamespaceNotFound (collection does not exist yet) is harmless
      if (err.code === 26 || err.codeName === 'NamespaceNotFound' || err.message?.includes('ns does not exist')) {
        indexes = [];
      } else {
        throw err;
      }
    }

    const obsoleteSingleIdx = indexes.find(
      (i) => i.name === 'dep_iata_1' || (Object.keys(i.key || {}).length === 1 && i.key.dep_iata === 1 && i.unique),
    );
    if (obsoleteSingleIdx) {
      this.logger.warn(`Dropping obsolete single-field unique index ${obsoleteSingleIdx.name} on RouteSyncState`);
      try {
        await col.dropIndex(obsoleteSingleIdx.name);
      } catch (err: any) {
        // Code 27: IndexNotFound is harmless (already dropped)
        if (err.code !== 27 && err.codeName !== 'IndexNotFound' && !err.message?.includes('index not found')) {
          throw err;
        }
      }
    }

    const hasCompound = indexes.some(
      (i) => i.key && i.key.dep_iata === 1 && i.key.source === 1 && i.unique === true,
    );
    if (!hasCompound) {
      this.logger.log('Creating compound unique index { dep_iata: 1, source: 1 } on RouteSyncState');
      await col.createIndex({ dep_iata: 1, source: 1 }, { unique: true, name: 'dep_iata_1_source_1' });
    }

    // Post-migration authoritative verification
    const finalIndexes = await col.indexes();
    const verifiedCompound = finalIndexes.some(
      (i) => i.key && i.key.dep_iata === 1 && i.key.source === 1 && i.unique === true,
    );
    if (!verifiedCompound) {
      throw new Error(
        'RouteSyncState post-migration verification failed: compound unique index { dep_iata: 1, source: 1 } is missing or non-unique',
      );
    }

    const remainingObsolete = finalIndexes.find(
      (i) => (i.name === 'dep_iata_1' && i.unique) ||
             (Object.keys(i.key || {}).length === 1 && i.key.dep_iata === 1 && i.unique === true),
    );
    if (remainingObsolete) {
      throw new Error(
        `RouteSyncState post-migration verification failed: obsolete single-field unique index '${remainingObsolete.name}' on dep_iata is still present`,
      );
    }
  }

  /**
   * Safely and idempotently migrates and reconciles RouteRef collection indexes.
   * Single owner of RouteRef index creation since RouteRef schema autoIndex is disabled.
   *
   * 1. Fresh database: creates collection and all intended RouteRef indexes.
   * 2. Existing database:
   *    - Drops ONLY the obsolete unique index on { airline_iata: 1, dep_iata: 1, arr_iata: 1 }
   *    - Reconciles source_key index options (replaces non-sparse or non-unique with unique sparse index)
   *    - Ensures missing secondary indexes exist ({ dep_iata, arr_iata }, { dep_iata, synced_at }, etc.)
   *    - Preserves all unrelated indexes
   *    - Inspects and normalizes legacy records lacking source_key without deleting them or inventing fake keys
   */
  async migrateIndexes(): Promise<IndexMigrationResult> {
    const result: IndexMigrationResult = {
      collectionExists: false,
      collectionCreated: false,
      obsoleteIndexDropped: false,
      sourceKeyIndexCreated: false,
      sourceKeyIndexAlreadyExisted: false,
      sourceKeyIndexReplaced: false,
      createdIndexes: [],
      missingSecondaryIndexesCreated: [],
      legacyDocuments: {
        missingCount: 0,
        nullCount: 0,
        emptyCount: 0,
        totalLegacyCount: 0,
        unsetOnNullOrEmptyCount: 0,
      },
      unrelatedIndexesPreserved: [],
    };

    const collection = this.routeRefModel?.collection;
    if (!collection) return result;

    let existingIndexes: any[] = [];
    let collectionExisted = true;

    try {
      existingIndexes = await collection.indexes();
      result.collectionExists = true;
    } catch (err: any) {
      if (
        err.code === 26 ||
        err.codeName === 'NamespaceNotFound' ||
        err.message?.includes('ns does not exist') ||
        err.message?.includes('NamespaceNotFound')
      ) {
        collectionExisted = false;
        result.collectionExists = false;
      } else {
        throw err;
      }
    }

    // Handle fresh database / collection does not exist
    if (!collectionExisted) {
      this.logger.log(`RouteRef collection ${collection.collectionName} does not exist yet. Creating collection and initializing all intended indexes.`);
      if (typeof this.routeRefModel.createCollection === 'function') {
        await this.routeRefModel.createCollection();
      } else if (typeof (collection as any).createCollection === 'function') {
        await (collection as any).createCollection();
      } else if (this.routeRefModel.db?.createCollection) {
        await this.routeRefModel.db.createCollection(collection.collectionName);
      }
      result.collectionCreated = true;
      result.collectionExists = true;

      // Create all required RouteRef indexes
      for (const target of INTENDED_ROUTEREF_INDEXES) {
        await collection.createIndex(target.key, target.options || {});
        result.createdIndexes.push(target.name);
      }
      result.sourceKeyIndexCreated = true;
      return result;
    }

    // Existing database: inspect existing indexes
    let exactSourceKeyIdx: any = null;

    for (const idx of existingIndexes) {
      if (isObsoleteRouteRefIndex(idx)) {
        this.logger.warn(`Dropping obsolete RouteRef unique index: ${idx.name} with key: ${JSON.stringify(idx.key)}`);
        await collection.dropIndex(idx.name);
        result.obsoleteIndexDropped = true;
        result.droppedIndexName = idx.name;
      } else if (isExactSourceKeyIndex(idx)) {
        exactSourceKeyIdx = idx;
      } else {
        // Check if this matches one of our intended secondary indexes
        const isIntendedSecondary = INTENDED_ROUTEREF_INDEXES.slice(1).some(target =>
          matchIndexKey(idx.key, target.key),
        );
        if (!isIntendedSecondary) {
          result.unrelatedIndexesPreserved.push(idx.name || 'unnamed');
        }
      }
    }

    // Reconcile source_key index options
    let needsSourceKeyCreation = false;

    if (exactSourceKeyIdx) {
      if (isCorrectSourceKeyIndex(exactSourceKeyIdx)) {
        // Case A: Correct existing unique sparse index -> preserve it, do not recreate
        result.sourceKeyIndexAlreadyExisted = true;
        result.sourceKeyIndexCreated = false;
        result.sourceKeyIndexReplaced = false;
      } else {
        // Case B / C: Option-mismatched (e.g. non-sparse or non-unique) -> drop and recreate
        this.logger.warn(
          `Dropping option-mismatched source_key index: ${exactSourceKeyIdx.name} (unique: ${exactSourceKeyIdx.unique}, sparse: ${exactSourceKeyIdx.sparse})`,
        );
        await collection.dropIndex(exactSourceKeyIdx.name);
        result.sourceKeyIndexReplaced = true;
        needsSourceKeyCreation = true;
      }
    } else {
      needsSourceKeyCreation = true;
    }

    // Inspect and handle legacy documents lacking source_key
    const missingCount = await this.routeRefModel.countDocuments({
      source_key: { $exists: false },
    });
    const nullCount = await this.routeRefModel.countDocuments({
      source_key: { $type: 10 }, // BSON type 10 = Null
    });
    const emptyCount = await this.routeRefModel.countDocuments({
      source_key: '',
    });

    result.legacyDocuments.missingCount = missingCount;
    result.legacyDocuments.nullCount = nullCount;
    result.legacyDocuments.emptyCount = emptyCount;
    result.legacyDocuments.totalLegacyCount = missingCount + nullCount + emptyCount;

    if (nullCount > 0 || emptyCount > 0) {
      const unsetRes = await this.routeRefModel.updateMany(
        {
          $or: [
            { source_key: { $type: 10 } },
            { source_key: '' },
          ],
        },
        { $unset: { source_key: '' } },
      );
      result.legacyDocuments.unsetOnNullOrEmptyCount =
        typeof unsetRes?.modifiedCount === 'number'
          ? unsetRes.modifiedCount
          : (nullCount + emptyCount);

      this.logger.warn(
        `Legacy RouteRef audit: ${missingCount} missing, ${nullCount} explicit null, ${emptyCount} empty string. ` +
        `Safely unset source_key on ${result.legacyDocuments.unsetOnNullOrEmptyCount} documents to allow sparse indexing without deleting data or inventing fake identities.`,
      );
    } else if (missingCount > 0) {
      this.logger.warn(
        `Found ${missingCount} legacy RouteRef documents with missing source_key. Safely preserved without modification (sparse index excludes missing keys).`,
      );
    }

    // Create intended unique sparse source_key index if needed
    if (needsSourceKeyCreation) {
      this.logger.log('Creating intended unique sparse index on source_key: 1');
      await collection.createIndex(
        { source_key: 1 },
        { unique: true, sparse: true },
      );
      result.sourceKeyIndexCreated = true;
      result.createdIndexes.push('source_key_1');
    }

    // Reconcile intended secondary indexes
    const secondaryTargets = INTENDED_ROUTEREF_INDEXES.slice(1);
    for (const target of secondaryTargets) {
      const alreadyExists = existingIndexes.some(idx => matchIndexKey(idx.key, target.key));
      if (!alreadyExists) {
        this.logger.log(`Creating missing intended secondary index: ${target.name}`);
        await collection.createIndex(target.key, target.options || {});
        result.missingSecondaryIndexesCreated.push(target.name);
        result.createdIndexes.push(target.name);
      }
    }

    return result;
  }
}
