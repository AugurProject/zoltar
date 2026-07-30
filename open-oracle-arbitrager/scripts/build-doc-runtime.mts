import { readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const outputPath = path.join(projectRoot, 'docs', 'chart-runtime.js')
const result = await Bun.build({
	entrypoints: [path.join(projectRoot, 'docs', 'chart-runtime.ts')],
	minify: true,
	target: 'browser',
})
if (!result.success || result.outputs.length !== 1) {
	throw new Error(`Could not build documentation chart runtime: ${result.logs.map(log => log.message).join('; ')}`)
}
const generated = await result.outputs[0]?.text()
if (generated === undefined) throw new Error('Documentation chart runtime build produced no output')

if (process.argv.includes('--check')) {
	const current = await readFile(outputPath, 'utf8').catch(error => {
		throw new Error(`Documentation chart runtime is missing: ${error instanceof Error ? error.message : String(error)}`)
	})
	if (current !== generated) throw new Error('Documentation chart runtime is stale; run bun run build:docs')
} else {
	await Bun.write(outputPath, generated)
}
