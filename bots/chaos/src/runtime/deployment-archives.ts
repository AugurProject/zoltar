import { readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { logDashboardFailure } from '@zoltar/bot-shared/dashboard/public-error'
import { assertDurableDeploymentFactory, assertDurableStateFactories } from '../config/deployment-state.ts'
import { isPristineBootstrapState } from '../state/pristine.ts'
import { executionProfileId } from '../config/execution-profile.ts'
import { loadSettings } from '../config/settings.ts'
import { loadDurableState } from '../state/operator-state.ts'
import { signerAddress } from './configuration-candidates.ts'

/** Archive runs retain their own owner file; the original owner remains the return destination. */
function archiveRoot(path: string) {
	return path.replace(/\.retired-[a-f0-9]{64}\.json$/, '')
}

export function deploymentArchivePath(activePath: string, id: string) {
	const root = archiveRoot(activePath)
	if (id === 'current') return root
	if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid deployment archive ID')
	return `${root}.retired-${id}.json`
}

export async function dashboardDeploymentArchives(activePath: string) {
	const root = archiveRoot(activePath)
	const prefix = `${basename(root)}.retired-`
	const ids = (await readdir(dirname(root)))
		.flatMap(entry => {
			if (!entry.startsWith(prefix) || !entry.endsWith('.json')) return []
			const id = entry.slice(prefix.length, -5)
			return /^[a-f0-9]{64}$/.test(id) ? [id] : []
		})
		.sort()
	return await Promise.all(
		['current', ...ids].map(async id => {
			const path = deploymentArchivePath(activePath, id)
			const active = resolve(path) === resolve(activePath)
			try {
				const loaded = await loadSettings(path)
				const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
				if (state.profileId !== executionProfileId(loaded.settings)) throw new Error('Deployment archive profile mismatch')
				assertDurableStateFactories(loaded.settings, state)
				if (!isPristineBootstrapState(state)) assertDurableDeploymentFactory(loaded.settings, state, loaded.settings.runtime.stateFile)
				const configuredSigner = signerAddress(loaded.settings)
				if (configuredSigner !== undefined && state.signerAddress !== undefined && configuredSigner.toLowerCase() !== state.signerAddress.toLowerCase()) throw new Error('Deployment archive signer mismatch')
				return {
					active,
					id,
					revision: loaded.revision,
					chainId: loaded.settings.network.chainId,
					network: loaded.settings.network.name,
					profileId: executionProfileId(loaded.settings),
					wallet: state.signerAddress ?? signerAddress(loaded.settings),
					status: state.retirement.status,
					addresses: Object.entries(loaded.settings.deployment).flatMap(([name, address]) => (address === undefined ? [] : [{ name, address }])),
				}
			} catch (error) {
				logDashboardFailure('chaos', `deployment-archive-read:${id}`, error)
				// Keep a damaged archive visible without exposing private configuration or filesystem details.
				return { active, id, error: 'Archive configuration and recovery state could not be verified.' }
			}
		}),
	)
}
