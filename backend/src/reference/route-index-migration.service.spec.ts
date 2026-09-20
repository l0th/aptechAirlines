import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  RouteIndexMigrationService,
  isObsoleteRouteRefIndex,
  isExactSourceKeyIndex,
  isCorrectSourceKeyIndex,
  matchIndexKey,
  INTENDED_ROUTEREF_INDEXES,
} from './route-index-migration.service';
import { RouteRef, RouteRefSchema, RouteSyncState } from './reference.schema';

describe('RouteIndexMigrationService - Deployment Safety & Index Ownership', () => {
  let service: RouteIndexMigrationService;
  let mockRouteRefModel: any;
  let mockCollection: any;
  let mockRouteSyncStateModel: any;
  let mockRouteSyncStateCollection: any;

  beforeEach(async () => {
    mockCollection = {
      collectionName: 'routerefs',
      indexes: jest.fn(),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
      createCollection: jest.fn().mockResolvedValue({}),
    };

    mockRouteRefModel = {
      collection: mockCollection,
      createCollection: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };

    mockRouteSyncStateCollection = {
      collectionName: 'routesyncstates',
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'dep_iata_1_source_1', key: { dep_iata: 1, source: 1 }, unique: true },
      ]),
      dropIndex: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn().mockResolvedValue('dep_iata_1_source_1'),
    };

    mockRouteSyncStateModel = {
      collection: mockRouteSyncStateCollection,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteIndexMigrationService,
        {
          provide: getModelToken(RouteRef.name),
          useValue: mockRouteRefModel,
        },
        {
          provide: getModelToken(RouteSyncState.name),
          useValue: mockRouteSyncStateModel,
        },
      ],
    }).compile();

    service = module.get<RouteIndexMigrationService>(RouteIndexMigrationService);
  });

  describe('1. Schema autoIndex ownership', () => {
    it('1. RouteRef schema autoIndex is explicitly disabled so migration owns index creation', () => {
      // Must be disabled at schema level so Mongoose does not build indexes before migration
      const autoIndexOption = RouteRefSchema.get('autoIndex') ?? (RouteRefSchema as any).options?.autoIndex;
      expect(autoIndexOption).toBe(false);
    });
  });

  describe('Predicate helpers', () => {
    it('isObsoleteRouteRefIndex recognizes exact old key pattern { airline_iata: 1, dep_iata: 1, arr_iata: 1, unique: true }', () => {
      const obsoleteIdx = {
        name: 'airline_iata_1_dep_iata_1_arr_iata_1',
        key: { airline_iata: 1, dep_iata: 1, arr_iata: 1 },
        unique: true,
      };
      expect(isObsoleteRouteRefIndex(obsoleteIdx)).toBe(true);
    });

    it('isObsoleteRouteRefIndex does NOT match unrelated indexes', () => {
      expect(isObsoleteRouteRefIndex({ name: '_id_', key: { _id: 1 } })).toBe(false);
      expect(isObsoleteRouteRefIndex({ name: 'dep_arr', key: { dep_iata: 1, arr_iata: 1 } })).toBe(false);
      expect(isObsoleteRouteRefIndex({ name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true })).toBe(false);
    });

    it('isExactSourceKeyIndex matches strictly { source_key: 1 }', () => {
      expect(isExactSourceKeyIndex({ key: { source_key: 1 } })).toBe(true);
      expect(isExactSourceKeyIndex({ key: { source_key: 1, extra: 1 } })).toBe(false);
      expect(isExactSourceKeyIndex({ key: { dep_iata: 1 } })).toBe(false);
    });

    it('isCorrectSourceKeyIndex checks both unique: true and sparse: true', () => {
      expect(isCorrectSourceKeyIndex({ key: { source_key: 1 }, unique: true, sparse: true })).toBe(true);
      expect(isCorrectSourceKeyIndex({ key: { source_key: 1 }, unique: true })).toBe(false);
      expect(isCorrectSourceKeyIndex({ key: { source_key: 1 }, unique: true, sparse: false })).toBe(false);
      expect(isCorrectSourceKeyIndex({ key: { source_key: 1 }, unique: false, sparse: true })).toBe(false);
    });

    it('matchIndexKey verifies key pattern equivalence', () => {
      expect(matchIndexKey({ dep_iata: 1, arr_iata: 1 }, { dep_iata: 1, arr_iata: 1 })).toBe(true);
      expect(matchIndexKey({ dep_iata: 1, arr_iata: 1 }, { dep_iata: 1 })).toBe(false);
      expect(matchIndexKey({ dep_iata: 1 }, { dep_iata: 1, arr_iata: 1 })).toBe(false);
    });
  });

  describe('Migration & Reconciliation Scenarios', () => {
    // 2. fresh collection/database → collection created and all required indexes created
    it('2. fresh collection/database -> collection created and all required indexes created', async () => {
      const nsNotFound: any = new Error('NamespaceNotFound: routerefs does not exist');
      nsNotFound.code = 26;
      nsNotFound.codeName = 'NamespaceNotFound';
      mockCollection.indexes.mockRejectedValue(nsNotFound);

      const res = await service.migrateIndexes();

      expect(res.collectionCreated).toBe(true);
      expect(res.collectionExists).toBe(true);
      expect(mockRouteRefModel.createCollection).toHaveBeenCalledTimes(1);
      // All 4 required RouteRef indexes created
      expect(mockCollection.createIndex).toHaveBeenCalledTimes(4);
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { source_key: 1 },
        { unique: true, sparse: true },
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { dep_iata: 1, arr_iata: 1 },
        {},
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { dep_iata: 1, synced_at: 1 },
        {},
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { dep_iata: 1, sync_generation: 1 },
        {},
      );
      expect(res.createdIndexes).toHaveLength(4);
    });

    // 3. existing correct RouteRef indexes → no unnecessary recreation
    it('3. existing correct RouteRef indexes -> no unnecessary recreation', async () => {
      const existingIndexes = [
        { name: '_id_', key: { _id: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ];
      mockCollection.indexes.mockResolvedValue(existingIndexes);

      const res = await service.migrateIndexes();

      expect(res.sourceKeyIndexAlreadyExisted).toBe(true);
      expect(res.sourceKeyIndexCreated).toBe(false);
      expect(res.sourceKeyIndexReplaced).toBe(false);
      expect(res.missingSecondaryIndexesCreated).toHaveLength(0);
      expect(mockCollection.dropIndex).not.toHaveBeenCalled();
      expect(mockCollection.createIndex).not.toHaveBeenCalled();
    });

    // 4. old compound unique index removed
    it('4. old compound unique index removed', async () => {
      const existingIndexes = [
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'airline_iata_1_dep_iata_1_arr_iata_1',
          key: { airline_iata: 1, dep_iata: 1, arr_iata: 1 },
          unique: true,
        },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ];
      mockCollection.indexes.mockResolvedValue(existingIndexes);

      const res = await service.migrateIndexes();

      expect(res.obsoleteIndexDropped).toBe(true);
      expect(res.droppedIndexName).toBe('airline_iata_1_dep_iata_1_arr_iata_1');
      expect(mockCollection.dropIndex).toHaveBeenCalledWith('airline_iata_1_dep_iata_1_arr_iata_1');
      expect(mockCollection.dropIndex).toHaveBeenCalledTimes(1);
    });

    // 5. old non-sparse source_key replaced
    it('5. old non-sparse source_key replaced', async () => {
      const existingIndexes = [
        { name: '_id_', key: { _id: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: false },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ];
      mockCollection.indexes.mockResolvedValue(existingIndexes);

      const res = await service.migrateIndexes();

      expect(res.sourceKeyIndexReplaced).toBe(true);
      expect(res.sourceKeyIndexCreated).toBe(true);
      expect(mockCollection.dropIndex).toHaveBeenCalledWith('source_key_1');
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { source_key: 1 },
        { unique: true, sparse: true },
      );
    });

    // 6. missing normal secondary index gets created
    it('6. missing normal secondary index gets created', async () => {
      const existingIndexes = [
        { name: '_id_', key: { _id: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        // Only dep_iata_arr_iata exists, the other 2 secondary indexes are missing
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
      ];
      mockCollection.indexes.mockResolvedValue(existingIndexes);

      const res = await service.migrateIndexes();

      expect(res.missingSecondaryIndexesCreated).toEqual([
        'dep_iata_1_synced_at_1',
        'dep_iata_1_sync_generation_1',
      ]);
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { dep_iata: 1, synced_at: 1 },
        {},
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { dep_iata: 1, sync_generation: 1 },
        {},
      );
    });

    // 7. unrelated indexes preserved
    it('7. unrelated indexes preserved', async () => {
      const existingIndexes = [
        { name: '_id_', key: { _id: 1 } },
        { name: 'custom_operator_index', key: { operator_code: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ];
      mockCollection.indexes.mockResolvedValue(existingIndexes);

      const res = await service.migrateIndexes();

      expect(res.unrelatedIndexesPreserved).toContain('custom_operator_index');
      expect(res.unrelatedIndexesPreserved).toContain('_id_');
      expect(mockCollection.dropIndex).not.toHaveBeenCalled();
    });

    // 8. second run idempotent
    it('8. second run is idempotent', async () => {
      const postMigrationIndexes = [
        { name: '_id_', key: { _id: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ];
      mockCollection.indexes.mockResolvedValue(postMigrationIndexes);

      const res = await service.migrateIndexes();

      expect(res.obsoleteIndexDropped).toBe(false);
      expect(res.sourceKeyIndexAlreadyExisted).toBe(true);
      expect(res.sourceKeyIndexCreated).toBe(false);
      expect(res.sourceKeyIndexReplaced).toBe(false);
      expect(res.missingSecondaryIndexesCreated).toHaveLength(0);
      expect(mockCollection.dropIndex).not.toHaveBeenCalled();
      expect(mockCollection.createIndex).not.toHaveBeenCalled();
    });

    // 9. real Mongo migration error still propagates
    it('9. real Mongo migration error still propagates through onModuleInit', async () => {
      const permissionDeniedError = new Error('MongoServerError: Unauthorized to create index');
      mockCollection.indexes.mockRejectedValue(permissionDeniedError);

      await expect(service.onModuleInit()).rejects.toThrow('Unauthorized to create index');
    });

    // Legacy documents handling
    it('handles legacy documents: unsets explicit null and empty string, leaves missing untouched', async () => {
      mockCollection.indexes.mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ]);
      mockRouteRefModel.countDocuments.mockImplementation((query: any) => {
        if (query?.source_key?.$exists === false) return Promise.resolve(7);
        if (query?.source_key?.$type === 10) return Promise.resolve(2);
        if (query?.source_key === '') return Promise.resolve(3);
        return Promise.resolve(0);
      });
      mockRouteRefModel.updateMany.mockResolvedValue({ modifiedCount: 5 });

      const res = await service.migrateIndexes();

      expect(res.legacyDocuments.missingCount).toBe(7);
      expect(res.legacyDocuments.nullCount).toBe(2);
      expect(res.legacyDocuments.emptyCount).toBe(3);
      expect(res.legacyDocuments.totalLegacyCount).toBe(12);
      expect(res.legacyDocuments.unsetOnNullOrEmptyCount).toBe(5);
      expect(mockRouteRefModel.updateMany).toHaveBeenCalledWith(
        { $or: [{ source_key: { $type: 10 } }, { source_key: '' }] },
        { $unset: { source_key: '' } },
      );
    });
  });

  describe('RouteSyncState Index Migration Fail-Fast & Idempotency', () => {
    it('1. Successfully drops obsolete dep_iata_1 and creates compound unique dep_iata_1_source_1', async () => {
      // Setup initial state: obsolete single index exists, compound does not
      mockRouteSyncStateCollection.indexes
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1', key: { dep_iata: 1 }, unique: true },
        ])
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1_source_1', key: { dep_iata: 1, source: 1 }, unique: true },
        ]);

      await service.migrateRouteSyncStateIndexes();

      expect(mockRouteSyncStateCollection.dropIndex).toHaveBeenCalledWith('dep_iata_1');
      expect(mockRouteSyncStateCollection.createIndex).toHaveBeenCalledWith(
        { dep_iata: 1, source: 1 },
        { unique: true, name: 'dep_iata_1_source_1' },
      );
    });

    it('2. Idempotently skips drop and create when compound unique already exists and obsolete is absent', async () => {
      mockRouteSyncStateCollection.indexes.mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'dep_iata_1_source_1', key: { dep_iata: 1, source: 1 }, unique: true },
      ]);

      await service.migrateRouteSyncStateIndexes();

      expect(mockRouteSyncStateCollection.dropIndex).not.toHaveBeenCalled();
      expect(mockRouteSyncStateCollection.createIndex).not.toHaveBeenCalled();
    });

    it('3. Fails fast and propagates error when dropIndex fails', async () => {
      mockRouteSyncStateCollection.indexes.mockResolvedValueOnce([
        { name: '_id_', key: { _id: 1 } },
        { name: 'dep_iata_1', key: { dep_iata: 1 }, unique: true },
      ]);
      mockRouteSyncStateCollection.dropIndex.mockRejectedValueOnce(
        new Error('LockTimeout: could not acquire index lock'),
      );

      await expect(service.migrateRouteSyncStateIndexes()).rejects.toThrow('LockTimeout');
    });

    it('4. Fails fast and propagates error when createIndex fails (e.g. duplicate key or option conflict)', async () => {
      mockRouteSyncStateCollection.indexes.mockResolvedValueOnce([
        { name: '_id_', key: { _id: 1 } },
      ]);
      mockRouteSyncStateCollection.createIndex.mockRejectedValueOnce(
        new Error('E11000 duplicate key error collection: routesyncstates'),
      );

      await expect(service.migrateRouteSyncStateIndexes()).rejects.toThrow('E11000 duplicate key error');
    });

    it('5. Fails fast when post-migration verification detects missing compound unique index', async () => {
      // First indexes check: empty
      mockRouteSyncStateCollection.indexes
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
        ])
        // Post-migration check: still missing compound index
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
        ]);

      await expect(service.migrateRouteSyncStateIndexes()).rejects.toThrow(
        'RouteSyncState post-migration verification failed: compound unique index { dep_iata: 1, source: 1 } is missing or non-unique',
      );
    });

    it('6. Fails fast when post-migration verification detects obsolete single index still present', async () => {
      mockRouteSyncStateCollection.indexes
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1', key: { dep_iata: 1 }, unique: true },
        ])
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1', key: { dep_iata: 1 }, unique: true },
          { name: 'dep_iata_1_source_1', key: { dep_iata: 1, source: 1 }, unique: true },
        ]);

      await expect(service.migrateRouteSyncStateIndexes()).rejects.toThrow(
        "RouteSyncState post-migration verification failed: obsolete single-field unique index 'dep_iata_1' on dep_iata is still present",
      );
    });

    it('7. Handles harmless IndexNotFound (code 27) on dropIndex without crashing', async () => {
      mockRouteSyncStateCollection.indexes
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1', key: { dep_iata: 1 }, unique: true },
        ])
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1_source_1', key: { dep_iata: 1, source: 1 }, unique: true },
        ]);

      const indexNotFoundErr: any = new Error('index not found with name [dep_iata_1]');
      indexNotFoundErr.code = 27;
      mockRouteSyncStateCollection.dropIndex.mockRejectedValueOnce(indexNotFoundErr);

      await expect(service.migrateRouteSyncStateIndexes()).resolves.toBeUndefined();
    });

    it('8. Handles harmless NamespaceNotFound (code 26) on fresh collection without crashing', async () => {
      const namespaceNotFoundErr: any = new Error('ns does not exist');
      namespaceNotFoundErr.code = 26;
      mockRouteSyncStateCollection.indexes
        .mockRejectedValueOnce(namespaceNotFoundErr)
        .mockResolvedValueOnce([
          { name: '_id_', key: { _id: 1 } },
          { name: 'dep_iata_1_source_1', key: { dep_iata: 1, source: 1 }, unique: true },
        ]);

      await expect(service.migrateRouteSyncStateIndexes()).resolves.toBeUndefined();
      expect(mockRouteSyncStateCollection.createIndex).toHaveBeenCalled();
    });

    it('9. Propagates RouteSyncState index migration failure through onModuleInit to abort bootstrap', async () => {
      // RouteRef succeeds
      mockCollection.indexes.mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'source_key_1', key: { source_key: 1 }, unique: true, sparse: true },
        { name: 'dep_iata_1_arr_iata_1', key: { dep_iata: 1, arr_iata: 1 } },
        { name: 'dep_iata_1_synced_at_1', key: { dep_iata: 1, synced_at: 1 } },
        { name: 'dep_iata_1_sync_generation_1', key: { dep_iata: 1, sync_generation: 1 } },
      ]);
      // RouteSyncState fails
      mockRouteSyncStateCollection.indexes.mockRejectedValue(
        new Error('MongoServerError: connection pool closed'),
      );

      await expect(service.onModuleInit()).rejects.toThrow('connection pool closed');
    });
  });
});
