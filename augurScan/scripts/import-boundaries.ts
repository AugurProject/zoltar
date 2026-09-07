export type ImportBoundaryViolation = {
	readonly file: string
	readonly imported: string
	readonly reason: string
}

const importsFrom = (source: string): readonly string[] =>
	[...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)].flatMap((match) =>
		match[1] === undefined ? [] : [match[1]],
	)

const capability = (file: string): 'api' | 'database' | 'repository' | 'projection' | 'indexer' | 'other' => {
	if (file.startsWith('src/api/') || file === 'src/api.ts' || file === 'src/http.ts') return 'api'
	if (file.startsWith('src/repositories/')) return 'repository'
	if (file.startsWith('src/projections/') || file === 'src/database-projections.ts' || file === 'src/projections.ts') return 'projection'
	if (file.startsWith('src/database/') || file === 'src/database.ts' || file.startsWith('src/database-') || file === 'src/schema.ts') return 'database'
	if (file.startsWith('src/indexer')) return 'indexer'
	return 'other'
}

export const importBoundaryViolations = (sources: ReadonlyMap<string, string>): readonly ImportBoundaryViolation[] => {
	const violations: ImportBoundaryViolation[] = []
	for (const [file, source] of sources) {
		const owner = capability(file)
		if ((file === 'src/api/router.ts' || file === 'src/api/serializers.ts') && /\bsql\s*(?:`|\.unsafe\s*\()/.test(source))
			violations.push({ file, imported: 'SQL execution', reason: 'HTTP routing and response serialization must not execute database queries' })
		for (const imported of importsFrom(source)) {
			if (file !== 'src/api.ts' && owner !== 'api' && owner !== 'repository' && /(?:^|\/)api\//.test(imported))
				violations.push({ file, imported, reason: 'API capabilities must be consumed through src/api.ts' })
			if (owner === 'api' && /(?:^|\/)(?:indexer(?:\/|(?:-runtime)?\.ts$)|database(?:\/|(?:-projections)?\.ts$)|projections(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'API parsing and routing must not depend on indexer or persistence implementations' })
			if (owner === 'database' && /(?:^|\/)(?:api(?:\/|\.ts$)|indexer(?:\/|(?:-runtime)?\.ts$)|projections(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'Database infrastructure must not depend on API, indexer, or projection orchestration' })
			if (owner === 'repository' && /(?:^|\/)(?:api(?:\/|\.ts$)|indexer(?:\/|(?:-runtime)?\.ts$)|database(?:\/|\.ts$)|projections(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'Read repositories must depend only on runtime-neutral domain and query contracts' })
			if (owner === 'projection' && /(?:^|\/)(?:api(?:\/|\.ts$)|indexer(?:\/|(?:-runtime)?\.ts$)|database(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'Projection derivation must remain independent of API, indexer, and database orchestration' })
			if (owner !== 'indexer' && file !== 'src/indexer.ts' && /(?:^|\/)indexer\//.test(imported))
				violations.push({ file, imported, reason: 'Indexer capabilities must be consumed through src/indexer.ts' })
			if (owner !== 'database' && file !== 'src/database.ts' && /(?:^|\/)database\//.test(imported))
				violations.push({ file, imported, reason: 'Database capabilities must be consumed through src/database.ts' })
			if (owner !== 'api' && owner !== 'repository' && /(?:^|\/)repositories\//.test(imported))
				violations.push({ file, imported, reason: 'Read repositories are private to the API query boundary' })
		}
	}
	return violations
}
