export type ImportBoundaryViolation = {
	readonly file: string
	readonly imported: string
	readonly reason: string
}

const importsFrom = (source: string): readonly string[] =>
	[...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)].flatMap((match) =>
		match[1] === undefined ? [] : [match[1]],
	)

const capability = (file: string): 'api' | 'database' | 'projection' | 'indexer' | 'other' => {
	if (file.startsWith('src/api/') || file === 'src/api.ts' || file === 'src/http.ts') return 'api'
	if (file.startsWith('src/projections/') || file === 'src/database-projections.ts' || file === 'src/projections.ts') return 'projection'
	if (file.startsWith('src/database/') || file === 'src/database.ts' || file.startsWith('src/database-') || file === 'src/schema.ts') return 'database'
	if (file.startsWith('src/indexer')) return 'indexer'
	return 'other'
}

export const importBoundaryViolations = (sources: ReadonlyMap<string, string>): readonly ImportBoundaryViolation[] => {
	const violations: ImportBoundaryViolation[] = []
	for (const [file, source] of sources) {
		const owner = capability(file)
		for (const imported of importsFrom(source)) {
			if (file !== 'src/api.ts' && owner !== 'api' && /(?:^|\/)api\//.test(imported))
				violations.push({ file, imported, reason: 'API capabilities must be consumed through src/api.ts' })
			if (owner === 'api' && /(?:^|\/)(?:indexer(?:\/|(?:-runtime)?\.ts$)|database(?:\/|(?:-projections)?\.ts$)|projections(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'API parsing and routing must not depend on indexer or persistence implementations' })
			if (owner === 'database' && /(?:^|\/)(?:api(?:\/|\.ts$)|indexer(?:\/|(?:-runtime)?\.ts$)|projections(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'Database infrastructure must not depend on API, indexer, or projection orchestration' })
			if (owner === 'projection' && /(?:^|\/)(?:api(?:\/|\.ts$)|indexer(?:\/|(?:-runtime)?\.ts$)|database(?:\/|\.ts$))/.test(imported))
				violations.push({ file, imported, reason: 'Projection derivation must remain independent of API, indexer, and database orchestration' })
			if (owner !== 'indexer' && file !== 'src/indexer.ts' && /(?:^|\/)indexer\//.test(imported))
				violations.push({ file, imported, reason: 'Indexer capabilities must be consumed through src/indexer.ts' })
			if (owner !== 'database' && file !== 'src/database.ts' && /(?:^|\/)database\//.test(imported))
				violations.push({ file, imported, reason: 'Database capabilities must be consumed through src/database.ts' })
		}
	}
	return violations
}
