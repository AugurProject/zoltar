import * as path from 'path'
import { getUiAppPaths, parseUiAppIdFromProcess } from './appPaths.mts'
import { normalizeBundlerPath } from './bundlerPaths.mts'
import { computeSimulationSnapshotKey, getSimulationSnapshotPaths, pruneStaleSimulationSnapshots, simulationSnapshotKeyDefine } from './simulationSnapshots.mts'
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

// The bundle carries the key of the sources it was built from, so it only restores prepared scenario states made for them.
const snapshotKey = await computeSimulationSnapshotKey(appPaths)

const result = await Bun.build({
	banner: WORKER_BANNER,
	define: simulationSnapshotKeyDefine(snapshotKey),
	entrypoints: [normalizeBundlerPath(appPaths.workerEntrypoint)],
	naming: { entry: 'tevmWorker.worker.js' },
	outdir: path.join(appPaths.appGeneratedJsRoot, 'simulation'),
	plugins: [createTevmBufferImportPlugin()],
	target: 'browser',
	sourcemap: 'linked',
})

if (!result.success) throw new Error(`Failed to build the ${appId} simulation worker: ${result.logs.map(log => log.message).join('\n')}`)

// The watch rebuild also removes stale snapshots; the parallel multi-app build does not, because sibling tasks rewrite
// generated inputs while it runs.
if (process.argv.includes('--prune-stale-snapshots')) {
	const snapshotStatus = await pruneStaleSimulationSnapshots(getSimulationSnapshotPaths(appPaths), snapshotKey)
	if (snapshotStatus === 'pruned') console.log(`[workers] Removed stale ${appId} simulation snapshots; run bun run ui:snapshots ${appId} to regenerate them`)
}
