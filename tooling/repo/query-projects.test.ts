import { expect, test } from 'bun:test'
import { projectQuery } from './query-projects.mts'

test('query exposes registry-owned cache and artifact inputs', async () => {
	const query = await projectQuery()
	expect(query.setupProjectPaths).toContain('bots/chaos')
	expect(new Set(query.setupProjectPaths).size).toBe(query.setupProjectPaths.length)
	expect(query.componentArtifactOutputs).toContain('ui/trading/ts/generated/contractArtifact.ts')
	expect(query.uiArtifactOutputs).toContain('ui/coreShared/js')
	expect(query.uiArtifactOutputs).toContain('ui/trading/dist')
	expect(query.dependencyCacheKey).toHaveLength(64)
	expect(query.generatedCacheKey).toHaveLength(64)
})
