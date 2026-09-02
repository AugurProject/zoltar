import * as path from 'path'
import { getUiAppPaths, parseUiAppIdFromProcess } from './appPaths.mts'
import { normalizeBundlerPath } from './bundlerPaths.mts'
import { createTevmBufferImportPlugin } from './tevmBufferImport.mts'
import { vendor } from './vendor.mts'

const appId = parseUiAppIdFromProcess('worker build')
const appPaths = getUiAppPaths(appId)
const artifactsAreCurrent = process.argv.includes('--artifacts-current')

if (appId === 'trading' && !artifactsAreCurrent) await vendor()

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
	banner: WORKER_BANNER,
	entrypoints: [normalizeBundlerPath(appPaths.workerEntrypoint)],
	naming: { entry: 'tevmWorker.worker.js' },
	outdir: path.join(appPaths.appGeneratedJsRoot, 'simulation'),
	plugins: [createTevmBufferImportPlugin()],
	target: 'browser',
	sourcemap: 'linked',
})

if (!result.success) throw new Error(`Failed to build the ${appId} simulation worker: ${result.logs.map(log => log.message).join('\n')}`)
