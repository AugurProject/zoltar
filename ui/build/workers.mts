import * as path from 'path'
import * as url from 'url'
import { promises as fs } from 'fs'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')

const WORKER_BANNER = `
const process = globalThis.process ?? {
	env: {},
	nextTick(callback, ...args) {
		queueMicrotask(() => {
			callback(...args)
		})
	},
	stderr: undefined,
	stdout: undefined,
}
globalThis.process ??= process
globalThis.global ??= globalThis
`.trim()

const workerEntryPath = path.join(UI_ROOT_PATH, 'ts', 'simulation', 'tevmWorker.ts')
const BANNER_LINE_COUNT = WORKER_BANNER.split('\n').length

const result = await Bun.build({
	entrypoints: [workerEntryPath],
	naming: { entry: 'tevmWorker.worker.js' },
	outdir: path.join(UI_ROOT_PATH, 'js', 'simulation'),
	target: 'browser',
	sourcemap: 'linked',
})

for (const output of result.outputs) {
	if (output.path.endsWith('.js')) {
		const originalCode = await output.text()
		await Bun.write(output.path, WORKER_BANNER + '\n' + originalCode)
	}
}

const { SourceMapConsumer, SourceMapGenerator } = await import('source-map')
for (const output of result.outputs) {
	if (!output.path.endsWith('.js.map')) continue

	const rawMap = JSON.parse(await output.text()) as unknown as import('source-map').RawSourceMap
	const consumer = new SourceMapConsumer(rawMap)
	const generator = new SourceMapGenerator(rawMap.file ? { file: rawMap.file } : {})

	for (let i = 0; i < rawMap.sources.length; i++) {
		const source = rawMap.sources[i]
		const content = rawMap.sourcesContent?.[i]
		if (source && content) generator.setSourceContent(source, content)
	}

	consumer.eachMapping(mapping => {
		if (!mapping.source) return

		generator.addMapping({
			source: mapping.source,
			original: { line: mapping.originalLine, column: mapping.originalColumn },
			generated: { line: mapping.generatedLine + BANNER_LINE_COUNT, column: mapping.generatedColumn },
			name: mapping.name ?? undefined,
		})
	})

	await fs.writeFile(output.path, generator.toString())
}
