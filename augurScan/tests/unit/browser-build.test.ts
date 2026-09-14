import { expect, test } from 'bun:test'
import path from 'node:path'

test('production browser graph excludes demo fixtures and fake API', async () => {
	const root = path.resolve(import.meta.dir, '../..')
	const build = await Bun.build({ entrypoints: [path.join(root, 'browser/live-app.ts')], target: 'browser', format: 'esm', sourcemap: 'external' })
	expect(build.success).toBe(true)
	const map = build.outputs.find(output => output.kind === 'sourcemap')
	if (map === undefined) throw new Error('Build did not return its source map')
	const metadata: unknown = JSON.parse(await map.text())
	if (typeof metadata !== 'object' || metadata === null || !('sources' in metadata) || !Array.isArray(metadata.sources)) throw new Error('Invalid source map')
	expect(metadata.sources.some(source => typeof source === 'string' && /demo-(api|fixtures|app)/.test(source))).toBe(false)
	expect(metadata.sources.some(source => typeof source === 'string' && source.includes('fetch-api'))).toBe(true)
})
