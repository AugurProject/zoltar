import { contentRevision, readFileIfPresent, writeRevisionedFile } from '@zoltar/bot-shared/config/durable-file'
import { assertProfileCandidates, chainSpecificPath, networkProfilePath, storedNetworkProfileCandidates, switchNetworkProfile, type ProfileCandidate } from '@zoltar/bot-shared/config/profiles'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { canonicalDeployment, canonicalRootMarketIdentity } from './canonical-deployment.ts'
import { parseSettings, serializedSettings, type OperatorSettings } from './settings.ts'

const defaultSettingsPath = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')

export async function loadSettings(path = resolve(process.env['ZOLTAR_LIQUIDATOR_CONFIG'] ?? defaultSettingsPath)) {
	const contents = await readFileIfPresent(path)
	if (contents === undefined) throw new Error(`Missing liquidator configuration at ${path}. Copy config/operator.example.json there and edit it.`)
	return { path, revision: contentRevision(contents), settings: parseSettings(JSON.parse(contents)) }
}

/**
 * The form a restart can start from: live execution with a memory-only signer is armed in the running process alone,
 * so the file keeps paused dry-run mode and a restart cannot execute without a saved key.
 */
function restartSafeSettings(settings: OperatorSettings): OperatorSettings {
	if (settings.privateKey !== undefined || !settings.runtime.execute) return settings
	return { ...settings, paused: true, runtime: { ...settings.runtime, execute: false } }
}

export async function saveSettings(path: string, settings: OperatorSettings, expectedRevision?: string) {
	const contents = `${JSON.stringify(serializedSettings(restartSafeSettings(settings)), undefined, 2)}\n`
	return await writeRevisionedFile(path, contents, { conflict: () => new Error('Configuration changed on disk; reload before saving'), expectedRevision })
}

async function loadSettingsProfile(path: string, network: NetworkName) {
	return await loadSettings(networkProfilePath(path, network))
		.then(value => value.settings)
		.catch(error => {
			if (error instanceof Error && error.message.startsWith('Missing liquidator configuration')) return undefined
			throw error
		})
}

async function assertSettingsProfileCandidates(path: string, candidates: readonly ProfileCandidate<OperatorSettings>[]) {
	await assertProfileCandidates({
		assertIdentity: candidate => {
			if (candidate.settings.network.name !== candidate.expected) throw new Error(`The ${candidate.expected} profile contains ${candidate.settings.network.name} settings`)
		},
		candidates,
		durablePaths: candidate => [candidate.settings.runtime.stateFile],
		errors: {
			crossChainPathReuse: 'Mainnet and Sepolia profiles must use distinct durable recovery state paths',
			reservedPathReuse: 'The durable recovery state path must not reuse the active configuration or chain profile files',
		},
		reservedPaths: [path, networkProfilePath(path, 'mainnet'), networkProfilePath(path, 'sepolia')],
	})
}

const settingsNetwork = (settings: OperatorSettings) => settings.network.name

export async function assertSettingsProfileIsolation(path: string, active: OperatorSettings) {
	const { candidates } = await storedNetworkProfileCandidates(active, settingsNetwork, network => loadSettingsProfile(path, network))
	await assertSettingsProfileCandidates(path, candidates)
}

export async function switchSettingsNetworkProfile(path: string, network: NetworkName, examplePath: string, preflight?: (target: OperatorSettings) => Promise<void>) {
	const current = await loadSettings(path)
	const switched = await switchNetworkProfile({
		assertCandidates: candidates => assertSettingsProfileCandidates(path, candidates),
		createProfile: async network => {
			const template = parseSettings(JSON.parse(await readFile(examplePath, 'utf8')))
			const chainId = network === 'mainnet' ? 1 : 11_155_111
			return {
				...template,
				deployment: canonicalDeployment(chainId),
				centralizedMarkets: { ...template.centralizedMarkets, ...canonicalRootMarketIdentity(chainId) },
				network: { chainId, explorerUrl: network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io', name: network },
				networkConfigured: false,
				paused: true,
				privateKey: undefined,
				runtime: {
					...template.runtime,
					execute: false,
					once: false,
					stateFile: chainSpecificPath(current.settings.runtime.stateFile, network),
					ui: current.settings.runtime.ui,
					uiHost: current.settings.runtime.uiHost,
					uiPort: current.settings.runtime.uiPort,
				},
			}
		},
		current,
		loadProfile: network => loadSettingsProfile(path, network),
		network,
		networkOf: settingsNetwork,
		preflight,
		saveActive: (settings, expectedRevision) => saveSettings(path, settings, expectedRevision),
		saveProfile: (network, settings) => saveSettings(networkProfilePath(path, network), settings),
	})
	return { path, ...switched }
}
