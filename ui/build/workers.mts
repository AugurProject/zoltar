import * as path from 'path'
import * as url from 'url'

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

const result = await Bun.build({
	entrypoints: [path.join(UI_ROOT_PATH, 'ts', 'simulation', 'tevmWorker.ts')],
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
