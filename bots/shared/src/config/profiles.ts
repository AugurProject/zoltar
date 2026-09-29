import { extname } from 'node:path'
import type { NetworkName } from '../monitoring/connectivity.ts'
import { persistentPathIdentitiesMatch, persistentPathIdentity } from './persistent-path.ts'

type ProfileProcessMode = { once: boolean; ui: boolean; uiHost: string; uiPort: number }

export function chainSpecificPath(path: string, network: NetworkName) {
	const extension = extname(path)
	const stem = (extension === '' ? path : path.slice(0, -extension.length)).replace(/\.(?:mainnet|sepolia)$/, '')
	return `${stem}.${network}${extension}`
}

export function networkProfilePath(path: string, network: NetworkName) {
	return `${path}.${network}.profile`
}

function assertCompatibleProfileProcessMode(current: { runtime: ProfileProcessMode }, target: { runtime: ProfileProcessMode }) {
	if (current.runtime.once !== target.runtime.once || current.runtime.ui !== target.runtime.ui || current.runtime.uiHost !== target.runtime.uiHost || current.runtime.uiPort !== target.runtime.uiPort) {
		throw new Error('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
}

/** A stored or proposed profile together with the network it must belong to. */
export type ProfileCandidate<Settings> = {
	expected: NetworkName
	settings: Settings
}

type ProfileIsolation<Candidate extends { expected: number | string }> = {
	/** Throws when a candidate's embedded chain identity differs from the chain it is stored for. */
	assertIdentity: (candidate: Candidate) => void
	candidates: readonly Candidate[]
	/** Every durable file a profile writes; different chains must never share one, even through links. */
	durablePaths: (candidate: Candidate) => readonly string[]
	errors: {
		crossChainPathReuse: string
		duplicatePathsWithinProfile?: ((candidate: Candidate) => string) | undefined
		reservedPathReuse: string
	}
	/** Configuration and profile files no durable path may alias. */
	reservedPaths: readonly string[]
}

type PathIdentity = Awaited<ReturnType<typeof persistentPathIdentity>>

function aliasesAny(identities: readonly PathIdentity[], target: PathIdentity) {
	return identities.some(identity => persistentPathIdentitiesMatch(identity, target))
}

/** Rejects profiles with the wrong chain identity and durable paths that alias reserved files or another chain's paths. */
export async function assertProfileCandidates<Candidate extends { expected: number | string }>(isolation: ProfileIsolation<Candidate>) {
	for (const candidate of isolation.candidates) isolation.assertIdentity(candidate)
	const reserved = await Promise.all(isolation.reservedPaths.map(persistentPathIdentity))
	const checked: { candidate: Candidate; durablePaths: PathIdentity[] }[] = []
	for (const candidate of isolation.candidates) {
		const durablePaths = await Promise.all(isolation.durablePaths(candidate).map(persistentPathIdentity))
		if (durablePaths.some((durablePath, index) => aliasesAny(durablePaths.slice(index + 1), durablePath))) {
			throw new Error(isolation.errors.duplicatePathsWithinProfile?.(candidate) ?? 'A chain profile must use distinct durable paths')
		}
		if (durablePaths.some(durablePath => aliasesAny(reserved, durablePath))) throw new Error(isolation.errors.reservedPathReuse)
		checked.push({ candidate, durablePaths })
	}
	for (const [index, current] of checked.entries()) {
		for (const target of checked.slice(index + 1)) {
			if (target.candidate.expected !== current.candidate.expected && target.durablePaths.some(targetPath => aliasesAny(current.durablePaths, targetPath))) throw new Error(isolation.errors.crossChainPathReuse)
		}
	}
}

/** The active settings followed by whichever preset profiles are stored beside them. */
export async function storedNetworkProfileCandidates<Settings>(active: Settings, network: (settings: Settings) => NetworkName, loadProfile: (network: NetworkName) => Promise<Settings | undefined>) {
	const mainnet = await loadProfile('mainnet')
	const sepolia = await loadProfile('sepolia')
	const candidates: ProfileCandidate<Settings>[] = [{ expected: network(active), settings: active }]
	if (mainnet !== undefined) candidates.push({ expected: 'mainnet', settings: mainnet })
	if (sepolia !== undefined) candidates.push({ expected: 'sepolia', settings: sepolia })
	return { candidates, mainnet, sepolia }
}

type NetworkProfileSettings = { paused: boolean; runtime: ProfileProcessMode }

type NetworkProfileSwitch<Settings extends NetworkProfileSettings> = {
	assertCandidates: (candidates: readonly ProfileCandidate<Settings>[]) => Promise<void>
	/** Builds a paused, unconfigured profile for a network that has never been stored. */
	createProfile: (network: NetworkName) => Promise<Settings>
	current: { revision: string; settings: Settings }
	loadProfile: (network: NetworkName) => Promise<Settings | undefined>
	network: NetworkName
	networkOf: (settings: Settings) => NetworkName
	preflight?: ((target: Settings) => Promise<void>) | undefined
	saveActive: (settings: Settings, expectedRevision: string) => Promise<string>
	saveProfile: (network: NetworkName, settings: Settings) => Promise<unknown>
}

/**
 * Stores the active settings as their network's profile and activates the target network's profile paused. Every
 * stored profile is validated before anything is written, and the active file is replaced only at its loaded revision.
 */
export async function switchNetworkProfile<Settings extends NetworkProfileSettings>(request: NetworkProfileSwitch<Settings>) {
	const { current, network, networkOf } = request
	const currentNetwork = networkOf(current.settings)
	const stored = await storedNetworkProfileCandidates(current.settings, networkOf, request.loadProfile)
	await request.assertCandidates(stored.candidates)
	if (currentNetwork === network) return current
	const target = { ...((network === 'mainnet' ? stored.mainnet : stored.sepolia) ?? (await request.createProfile(network))), paused: true }
	await request.assertCandidates([
		{ expected: currentNetwork, settings: current.settings },
		{ expected: network, settings: target },
	])
	assertCompatibleProfileProcessMode(current.settings, target)
	await request.preflight?.(target)
	await request.saveProfile(currentNetwork, { ...current.settings, paused: true })
	await request.saveProfile(network, target)
	const revision = await request.saveActive(target, current.revision)
	return { revision, settings: target }
}
