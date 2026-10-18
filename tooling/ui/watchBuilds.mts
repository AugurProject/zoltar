import type { UiAppPaths } from './appPaths.mts'
import { createBuildQueue } from './buildQueue.mts'

type BuildJob = 'contracts' | 'shared' | 'vendor' | 'worker'
type BuildStep = { command: string[]; cwd: string; label: string }

/** Owns the watcher's build commands and the downstream work each successful build requires. */
export function createWatchBuilds({ appPaths, bunExecutablePath, isStopped, onIdle, run }: { appPaths: UiAppPaths; bunExecutablePath: string; isStopped: () => boolean; onIdle: (reason: string) => void; run: (job: BuildJob, step: BuildStep, reason: string) => Promise<boolean> }) {
	const { appId, repositoryRoot, coreSharedRoot, vendorBuildScript, workersBuildScript } = appPaths
	const steps: Record<BuildJob, BuildStep> = {
		contracts: { command: [bunExecutablePath, './tooling/contracts/build-app-contracts.mts', appId], cwd: repositoryRoot, label: 'Solidity and UI contract artifacts' },
		shared: { command: [bunExecutablePath, './tooling/repo/build-shared.mts', appId], cwd: repositoryRoot, label: 'Shared TypeScript build' },
		vendor: { command: [bunExecutablePath, vendorBuildScript, appId, '--scoped-artifacts'], cwd: coreSharedRoot, label: 'Vendor rebuild' },
		worker: { command: [bunExecutablePath, workersBuildScript, appId, '--artifacts-current'], cwd: coreSharedRoot, label: 'Simulation worker rebuild' },
	}
	const queue = createBuildQueue<BuildJob>({
		// Upstream inputs always rebuild before the jobs that consume their outputs.
		priority: ['shared', 'contracts', 'vendor', 'worker'],
		isStopped,
		onIdle,
		run: async (job, reason) => {
			if (!(await run(job, steps[job], reason))) return false
			if (job === 'contracts' && appId === 'trading') void queue.enqueue('vendor', reason)
			if (job === 'shared' || job === 'vendor') void queue.enqueue('worker', reason)
			return true
		},
	})
	return {
		runVendorBuild: (reason: string) => queue.enqueue('vendor', reason),
		runWorkerBuild: (reason: string) => queue.enqueue('worker', reason),
		runSharedBuild: (reason: string) => queue.enqueue('shared', reason),
		runContractBuild: (reason: string) => queue.enqueue('contracts', reason),
		runProjectArtifactBuild: (reason: string) => queue.enqueue(appId === 'trading' ? 'vendor' : 'contracts', reason),
	}
}
