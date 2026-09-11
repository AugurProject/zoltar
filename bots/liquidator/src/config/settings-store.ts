import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { persistentPathIdentitiesMatch, persistentPathIdentity } from '@zoltar/bot-shared/config/persistent-path'
import type { NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { canonicalDeployment, canonicalRootMarketIdentity } from './canonical-deployment.ts'
import { parseSettings, serializedSettings, type OperatorSettings } from './settings.ts'

type SettingsFileHandle = {
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type SettingsFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx', mode?: number) => Promise<SettingsFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

const settingsFilesystem: SettingsFilesystem = {
	mkdir,
	open,
	readFile,
	rename,
	rm,
}

const defaultSettingsPath = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')

function revision(contents: string) {
	return createHash('sha256').update(contents).digest('hex')
}

export async function loadSettings(path = resolve(process.env['ZOLTAR_LIQUIDATOR_CONFIG'] ?? defaultSettingsPath)) {
	const contents = await readFile(path, 'utf8').catch(error => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	})
	if (contents === undefined) throw new Error(`Missing liquidator configuration at ${path}. Copy config/operator.example.json there and edit it.`)
	return { path, revision: revision(contents), settings: parseSettings(JSON.parse(contents)) }
}

export async function saveSettings(path: string, settings: OperatorSettings, expectedRevision?: string, filesystem: SettingsFilesystem = settingsFilesystem) {
	const contents = `${JSON.stringify(serializedSettings(settings), undefined, 2)}\n`
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	if (expectedRevision !== undefined) {
		const current = await filesystem.readFile(path, 'utf8')
		if (revision(current) !== expectedRevision) throw new Error('Configuration changed on disk; reload before saving')
	}
	const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
	const handle = await filesystem.open(temporaryPath, 'wx', 0o600)
	try {
		await handle.writeFile(contents, { encoding: 'utf8' })
		await handle.sync()
		await handle.close()
		await filesystem.rename(temporaryPath, path)
		const directoryHandle = await filesystem.open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await handle.close().catch(() => undefined)
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
	return revision(contents)
}

function chainSpecificPath(path: string, network: NetworkName) {
	const extension = extname(path)
	const stem = (extension === '' ? path : path.slice(0, -extension.length)).replace(/\.(?:mainnet|sepolia)$/, '')
	return `${stem}.${network}${extension}`
}

function settingsProfilePath(path: string, network: NetworkName) {
	return `${path}.${network}.profile`
}

type SettingsProfileCandidate = { expectedNetwork: NetworkName; settings: OperatorSettings }

async function loadSettingsProfile(path: string, network: NetworkName) {
	return await loadSettings(settingsProfilePath(path, network))
		.then(value => value.settings)
		.catch(error => {
			if (error instanceof Error && error.message.startsWith('Missing liquidator configuration')) return undefined
			throw error
		})
}

async function assertSettingsProfileCandidates(path: string, candidates: readonly SettingsProfileCandidate[]) {
	const reservedPaths = await Promise.all([path, settingsProfilePath(path, 'mainnet'), settingsProfilePath(path, 'sepolia')].map(persistentPathIdentity))
	const candidatePaths: { candidate: SettingsProfileCandidate; statePath: Awaited<ReturnType<typeof persistentPathIdentity>> }[] = []
	for (const candidate of candidates) {
		if (candidate.settings.network.name !== candidate.expectedNetwork) throw new Error(`The ${candidate.expectedNetwork} profile contains ${candidate.settings.network.name} settings`)
		const statePath = await persistentPathIdentity(candidate.settings.runtime.stateFile)
		if (reservedPaths.some(reservedPath => persistentPathIdentitiesMatch(reservedPath, statePath))) throw new Error('The durable recovery state path must not reuse the active configuration or chain profile files')
		candidatePaths.push({ candidate, statePath })
	}
	for (let index = 0; index < candidatePaths.length; index += 1) {
		const current = candidatePaths[index]
		if (current === undefined) continue
		for (const target of candidatePaths.slice(index + 1)) {
			if (target.candidate.expectedNetwork !== current.candidate.expectedNetwork && persistentPathIdentitiesMatch(current.statePath, target.statePath)) throw new Error('Mainnet and Sepolia profiles must use distinct durable recovery state paths')
		}
	}
}

function assertCompatibleProfileProcessMode(current: OperatorSettings, target: OperatorSettings) {
	if (current.runtime.once !== target.runtime.once || current.runtime.ui !== target.runtime.ui || current.runtime.uiHost !== target.runtime.uiHost || current.runtime.uiPort !== target.runtime.uiPort) {
		throw new Error('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
}

export async function assertSettingsProfileIsolation(path: string, active: OperatorSettings) {
	const mainnet = await loadSettingsProfile(path, 'mainnet')
	const sepolia = await loadSettingsProfile(path, 'sepolia')
	const candidates: SettingsProfileCandidate[] = [{ expectedNetwork: active.network.name, settings: active }]
	if (mainnet !== undefined) candidates.push({ expectedNetwork: 'mainnet', settings: mainnet })
	if (sepolia !== undefined) candidates.push({ expectedNetwork: 'sepolia', settings: sepolia })
	await assertSettingsProfileCandidates(path, candidates)
}

export async function switchSettingsNetworkProfile(path: string, network: NetworkName, examplePath: string, preflight?: (target: OperatorSettings) => Promise<void>) {
	const current = await loadSettings(path)
	const mainnet = await loadSettingsProfile(path, 'mainnet')
	const sepolia = await loadSettingsProfile(path, 'sepolia')
	const storedCandidates: SettingsProfileCandidate[] = [{ expectedNetwork: current.settings.network.name, settings: current.settings }]
	if (mainnet !== undefined) storedCandidates.push({ expectedNetwork: 'mainnet', settings: mainnet })
	if (sepolia !== undefined) storedCandidates.push({ expectedNetwork: 'sepolia', settings: sepolia })
	await assertSettingsProfileCandidates(path, storedCandidates)
	if (current.settings.network.name === network) return current
	let target = network === 'mainnet' ? mainnet : sepolia
	if (target === undefined) {
		const template = parseSettings(JSON.parse(await readFile(examplePath, 'utf8')))
		const chainId = network === 'mainnet' ? 1 : 11_155_111
		target = {
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
	}
	target = { ...target, paused: true }
	await assertSettingsProfileCandidates(path, [
		{ expectedNetwork: current.settings.network.name, settings: current.settings },
		{ expectedNetwork: network, settings: target },
	])
	assertCompatibleProfileProcessMode(current.settings, target)
	await preflight?.(target)
	await saveSettings(settingsProfilePath(path, current.settings.network.name), { ...current.settings, paused: true })
	await saveSettings(settingsProfilePath(path, network), target)
	const savedRevision = await saveSettings(path, target, current.revision)
	return { path, revision: savedRevision, settings: target }
}
