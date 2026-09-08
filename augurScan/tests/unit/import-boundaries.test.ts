import { expect, test } from 'bun:test'
import { importBoundaryViolations } from '../../scripts/import-boundaries.ts'

test('keeps API, database, projection, and indexer capability boundaries directed', () => {
	const sources = new Map([
		['src/server.ts', "import { handleApi } from './api.ts'"],
		['src/api/routes.ts', "import { parse } from './validation.ts'"],
		['src/database.ts', "import { encode } from './database-json.ts'"],
		['src/projections.ts', "import type { Log } from './types.ts'"],
	])
	expect(importBoundaryViolations(sources)).toEqual([])

	sources.set('src/server.ts', "import { listLogs } from './api/logs.ts'")
	sources.set('src/api/routes.ts', "import { ScannerDatabase } from '../database.ts'")
	sources.set('src/database.ts', "import { run } from './indexer.ts'")
	sources.set('src/projections.ts', "import { handleApi } from './api.ts'")
	expect(importBoundaryViolations(sources).map(({ file }) => file)).toEqual(['src/server.ts', 'src/api/routes.ts', 'src/database.ts', 'src/projections.ts'])
})

test('keeps extracted indexer and database capabilities behind their public facades', () => {
	const sources = new Map([
		['src/indexer.ts', "export { NetworkIndexer } from './indexer/block-ingestion.ts'"],
		['src/indexer/block-ingestion.ts', "import { NetworkIndexerLogScanner } from './log-scanner.ts'"],
		['src/database.ts', "export { ScannerDatabase } from './database/block-persistence.ts'"],
		['src/database/block-persistence.ts', "import { ScannerHistoryRepository } from './history-repository.ts'"],
	])
	expect(importBoundaryViolations(sources)).toEqual([])

	sources.set('src/server.ts', "import { NetworkIndexer } from './indexer/block-ingestion.ts'")
	sources.set('src/api/routes.ts', "import { ScannerHistoryRepository } from '../database/history-repository.ts'")
	expect(importBoundaryViolations(sources).map(({ file, reason }) => ({ file, reason }))).toEqual([
		{ file: 'src/server.ts', reason: 'Indexer capabilities must be consumed through src/indexer.ts' },
		{ file: 'src/api/routes.ts', reason: 'API parsing and routing must not depend on indexer or persistence implementations' },
		{ file: 'src/api/routes.ts', reason: 'Database capabilities must be consumed through src/database.ts' },
	])
})

test('keeps read repositories private to API controllers and SQL out of every HTTP layer', () => {
	const sources = new Map([
		['src/api/router.ts', "import { networkCatalog } from '../repositories/catalog.ts'"],
		['src/api/serializers.ts', "import { parsedJsonColumn } from '../record-serialization.ts'"],
		['src/repositories/catalog.ts', "import type { SQL } from 'bun'"],
		['src/server.ts', "import { readIndexerHealth } from './database.ts'"],
	])
	expect(importBoundaryViolations(sources)).toEqual([])

	sources.set('src/api/address-history.ts', "import type { SQL } from 'bun'\nconst rows = sql`SELECT 1`")
	sources.set('src/api/serializers.ts', "const rows = sql.unsafe('SELECT 1')")
	sources.set('src/repositories/catalog.ts', "import { json } from '../api/serializers.ts'")
	sources.set('src/server.ts', "import { networkCatalog } from './repositories/catalog.ts'\nimport { readIndexerHealth } from './database/indexer-health.ts'")
	expect(importBoundaryViolations(sources).map(({ file, reason }) => ({ file, reason }))).toEqual([
		{ file: 'src/api/serializers.ts', reason: 'HTTP parsing, routing, and response serialization must not execute database queries' },
		{ file: 'src/repositories/catalog.ts', reason: 'Read repositories must depend only on runtime-neutral domain and query contracts' },
		{ file: 'src/server.ts', reason: 'Read repositories are private to the API query boundary' },
		{ file: 'src/server.ts', reason: 'Database capabilities must be consumed through src/database.ts' },
		{ file: 'src/api/address-history.ts', reason: 'HTTP parsing, routing, and response serialization must not execute database queries' },
	])
})
