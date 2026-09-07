import { expect, test } from 'bun:test'
import { importBoundaryViolations } from '../scripts/import-boundaries.ts'

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
