#!/usr/bin/env bun

import { access, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { privateKeyToAccount, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { checkPrivateTransactionSubmissionEndpoints } from '@zoltar/bot-shared/monitoring/connectivity'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import { assertSettingsProfileIsolation, CHAOS_ECOSYSTEMS, loadSettings, type OperatorSettings } from '../config/settings.ts'
import { acquireChaosProcessLocks, ChaosProcessLockAcquisitionError, type ChaosProcessLocks } from '../core/process-locks.ts'
import type { CanonicalUintString } from '../core/units.ts'
import { validateCarryProofJournalSidecarIfPresent } from '../monitoring/carry-proof-journal.ts'
import { carryProofDeploymentProfileId } from '../monitoring/carry-proof-scan.ts'
import { validateImmutableTopologySidecarIfPresent } from '../monitoring/topology-cache.ts'
import { CHAOS_OPERATION_CATALOG } from '../operations/catalog.ts'
import { CONSENSUS_FINALITY_HORIZON_BLOCKS } from '../operations/timing.ts'
import type { ChaosReadClient } from '../monitoring/discovery.ts'
import { canonicalAnchor, chaosReadClients, chaosReadEndpoints, createChaosReadPool, discoverWithQuorum } from '../runtime/canonical-scan.ts'
import { requiredLiveInventory } from '../runtime/live-readiness.ts'
import { loadDurableState, type DurableState } from '../state/operator-state.ts'

type DoctorReaderResult = {
	codeRoots: number
	endpoint: string
	finalizedBlock: string
	logChunkCount: number
	logCount: number
	logFromBlock: string
	logToBlock: string
}

type DeploymentRoot = { address: Address; name: string }

export type ChaosDoctorProbeResult = {
	anchor: { blockHash: string; blockNumber: bigint }
	readerResults: DoctorReaderResult[]
	relayChecks: number
	snapshot: {
		auctions: readonly unknown[]
		pairs: readonly unknown[]
		pools: readonly unknown[]
		questions: readonly unknown[]
		reports: readonly unknown[]
		universes: readonly { id: string; repToken: string }[]
		wallet: { ethBalanceAttoEth: CanonicalUintString; tokens: readonly { address: string; balance: string; symbol: string }[] }
		warnings: readonly string[]
	}
}

export type ChaosDoctorDependencies = {
	acquireLocks: (settings: OperatorSettings) => Promise<Pick<ChaosProcessLocks, 'release'>>
	assertProfileIsolation: typeof assertSettingsProfileIsolation
	load: typeof loadSettings
	loadState: typeof loadDurableState
	probe: (settings: OperatorSettings, wallet: `0x${string}`) => Promise<ChaosDoctorProbeResult>
	validateCompanionState: (settings: OperatorSettings) => Promise<{ carryProofJournal: 'absent' | 'valid'; immutableTopology: 'absent' | 'valid' }>
	verifyStateParent: (stateFile: string) => Promise<void>
}

async function verifyStateParent(stateFile: string) {
	const directory = dirname(stateFile)
	const directoryMetadata = await lstat(directory)
	if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) throw new Error(`Runtime state parent ${directory} must be a real directory`)
	const currentUid = process.getuid?.()
	if (currentUid !== undefined && directoryMetadata.uid !== currentUid) throw new Error(`Runtime state parent ${directory} must be owned by the bot process user`)
	if ((directoryMetadata.mode & 0o7777) !== 0o700) throw new Error(`Runtime state parent ${directory} must have owner-only mode 0700`)
	await access(directory, constants.R_OK | constants.W_OK | constants.X_OK)
	try {
		const stateMetadata = await lstat(stateFile)
		if (stateMetadata.isSymbolicLink() || !stateMetadata.isFile()) throw new Error(`Runtime state ${stateFile} must be a regular file`)
		if (currentUid !== undefined && stateMetadata.uid !== currentUid) throw new Error(`Runtime state ${stateFile} must be owned by the bot process user`)
		if ((stateMetadata.mode & 0o7777) !== 0o600) throw new Error(`Runtime state ${stateFile} must have owner-only mode 0600`)
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
		throw error
	}
}

type FinalizedBlockIdentity = { hash: string; number: bigint }
type ObservedBlockIdentity = { hash?: string | null | undefined; number?: bigint | null | undefined }

async function finalizedBlockIdentity(url: string): Promise<FinalizedBlockIdentity> {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: ['finalized', false] }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(10_000),
	})
	if (!response.ok) throw new Error(`Finalized-tag probe returned HTTP ${response.status.toString()}`)
	const contentLength = response.headers.get('content-length')
	if (contentLength !== null && Number(contentLength) > 65_536) throw new Error('Finalized-tag probe response exceeds 64 KiB')
	if (response.body === null) throw new Error('Finalized-tag probe returned no response body')
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let byteLength = 0
	for (;;) {
		const chunk = await reader.read()
		if (chunk.done) break
		byteLength += chunk.value.byteLength
		if (byteLength > 65_536) {
			await reader.cancel()
			throw new Error('Finalized-tag probe response exceeds 64 KiB')
		}
		chunks.push(chunk.value)
	}
	const bytes = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	let body: unknown
	try {
		body = JSON.parse(new TextDecoder().decode(bytes))
	} catch (error) {
		throw new Error('Finalized-tag probe returned invalid JSON', { cause: error })
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('Finalized-tag probe returned an invalid JSON-RPC envelope')
	const result = Reflect.get(body, 'result')
	if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Finalized-tag probe did not return a block')
	const number = Reflect.get(result, 'number')
	const hash = Reflect.get(result, 'hash')
	if (typeof number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(number) || typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
		throw new Error('Finalized-tag probe returned a block without a valid identity')
	}
	return { hash, number: BigInt(number) }
}

export function commonFreshFinalizedBlockNumber(anchorBlockNumber: bigint, identities: readonly FinalizedBlockIdentity[]) {
	if (identities.length === 0) throw new Error('Doctor requires at least one finalized checkpoint')
	let commonBlockNumber = anchorBlockNumber
	for (const identity of identities) {
		if (identity.number > anchorBlockNumber) throw new Error('RPC returned a finalized block ahead of the quorum anchor')
		const lag = anchorBlockNumber - identity.number
		if (lag > CONSENSUS_FINALITY_HORIZON_BLOCKS) {
			throw new Error(`RPC finalized checkpoint is ${lag.toString()} blocks behind the quorum anchor, exceeding the ${CONSENSUS_FINALITY_HORIZON_BLOCKS.toString()}-block launch limit`)
		}
		if (identity.number < commonBlockNumber) commonBlockNumber = identity.number
	}
	return commonBlockNumber
}

function normalizedObservedBlock(block: ObservedBlockIdentity, expectedBlockNumber: bigint, label: string) {
	if (block.number !== expectedBlockNumber || block.hash == null || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
		throw new Error(`${label} did not return block ${expectedBlockNumber.toString()} with a valid identity`)
	}
	return block.hash.toLowerCase()
}

export function assertCommonFinalizedBlockResults(commonBlockNumber: bigint, blocks: readonly ObservedBlockIdentity[]) {
	if (blocks.length === 0) throw new Error('Doctor requires at least one common finalized-block observation')
	const hashes = new Set<string>()
	for (const block of blocks) {
		hashes.add(normalizedObservedBlock(block, commonBlockNumber, 'RPC'))
	}
	if (hashes.size !== 1) throw new Error(`RPC readers disagree on common finalized block ${commonBlockNumber.toString()}`)
	const hash = hashes.values().next().value
	if (hash === undefined) throw new Error('Common finalized block hash is unavailable')
	return hash
}

export function assertFinalizedTagsMatchCommonBlock(commonBlockNumber: bigint, commonBlockHash: string, checkpoints: readonly FinalizedBlockIdentity[], label = 'RPC') {
	if (!/^0x[0-9a-fA-F]{64}$/.test(commonBlockHash)) throw new Error('Common finalized block hash is invalid')
	for (const checkpoint of checkpoints) {
		if (checkpoint.number === commonBlockNumber && checkpoint.hash.toLowerCase() !== commonBlockHash.toLowerCase()) {
			throw new Error(`${label} finalized-tag hash does not match common finalized block ${commonBlockNumber.toString()}`)
		}
	}
}

export function assertStableFinalizedCheckpointResults(initial: readonly FinalizedBlockIdentity[], initialBlocksBeforeRecheck: readonly ObservedBlockIdentity[], rechecked: readonly FinalizedBlockIdentity[], initialBlocksAfterRecheck: readonly ObservedBlockIdentity[], recheckedBlocks: readonly ObservedBlockIdentity[]) {
	const observationCount = initial.length
	if (observationCount === 0) throw new Error('Doctor requires at least one finalized checkpoint observation')
	if (initialBlocksBeforeRecheck.length !== observationCount || rechecked.length !== observationCount || initialBlocksAfterRecheck.length !== observationCount || recheckedBlocks.length !== observationCount) {
		throw new Error('Doctor finalized-checkpoint proof is incomplete')
	}
	for (const [label, checkpoints] of [
		['initial', initial],
		['rechecked', rechecked],
	] as const) {
		const hashesByHeight = new Map<bigint, string>()
		for (const checkpoint of checkpoints) {
			const hash = checkpoint.hash.toLowerCase()
			const existing = hashesByHeight.get(checkpoint.number)
			if (existing !== undefined && existing !== hash) throw new Error(`RPC readers disagree on ${label} finalized-tag block ${checkpoint.number.toString()}`)
			hashesByHeight.set(checkpoint.number, hash)
		}
	}
	for (let index = 0; index < observationCount; index += 1) {
		const first = initial[index]
		const before = initialBlocksBeforeRecheck[index]
		const second = rechecked[index]
		const after = initialBlocksAfterRecheck[index]
		const secondBlock = recheckedBlocks[index]
		if (first === undefined || before === undefined || second === undefined || after === undefined || secondBlock === undefined) throw new Error('Doctor finalized-checkpoint proof is incomplete')
		const expectedInitialHash = first.hash.toLowerCase()
		if (normalizedObservedBlock(before, first.number, 'RPC finalized-checkpoint proof') !== expectedInitialHash) throw new Error(`RPC finalized checkpoint ${first.number.toString()} does not match its initial finalized-tag hash`)
		if (second.number < first.number) throw new Error(`RPC finalized checkpoint regressed from ${first.number.toString()} to ${second.number.toString()}`)
		if (second.number === first.number && second.hash.toLowerCase() !== expectedInitialHash) throw new Error(`RPC finalized checkpoint ${first.number.toString()} changed hash during the launch proof`)
		if (normalizedObservedBlock(after, first.number, 'RPC finalized-checkpoint stability proof') !== expectedInitialHash) throw new Error(`RPC finalized checkpoint ${first.number.toString()} changed after the finalized-tag recheck`)
		if (normalizedObservedBlock(secondBlock, second.number, 'RPC rechecked finalized-checkpoint proof') !== second.hash.toLowerCase()) {
			throw new Error(`RPC rechecked finalized checkpoint ${second.number.toString()} does not match its finalized-tag hash`)
		}
	}
}

const MAXIMUM_DOCTOR_LOG_CHUNK_BLOCKS = 256n

export async function boundedAdaptiveLogRange(client: Pick<ChaosReadClient, 'getLogs'>, addresses: readonly Address[], fromBlock: bigint, toBlock: bigint) {
	let chunkCount = 0
	const logs = await fetchLogsWithAdaptiveRanges({ nextBlock: fromBlock }, toBlock, MAXIMUM_DOCTOR_LOG_CHUNK_BLOCKS, async range => {
		chunkCount += 1
		return await client.getLogs({ address: addresses, fromBlock: range.fromBlock, toBlock: range.toBlock })
	})
	return { chunkCount, logCount: logs.length }
}

export function assertDeploymentRootCodeResults(roots: readonly DeploymentRoot[], codes: readonly (`0x${string}` | undefined)[], endpoint: string) {
	if (codes.length !== roots.length) throw new Error(`RPC ${endpoint} returned an incomplete deployment-code result set`)
	const missing = roots.filter((_root, index) => {
		const code = codes[index]
		return code === undefined || code === '0x'
	})
	if (missing.length !== 0) throw new Error(`RPC ${endpoint} found no bytecode at configured roots: ${missing.map(root => root.name).join(', ')}`)
	return roots.length
}

async function defaultProbe(settings: OperatorSettings, wallet: `0x${string}`): Promise<ChaosDoctorProbeResult> {
	const pool = createChaosReadPool(settings)
	const anchor = await canonicalAnchor(settings, pool)
	if (settings.runtime.protocolStartBlock > anchor.blockNumber) throw new Error(`Configured protocol start block ${settings.runtime.protocolStartBlock.toString()} is ahead of canonical block ${anchor.blockNumber.toString()}`)
	const discovery = await discoverWithQuorum(settings, pool, wallet, anchor, undefined, undefined)
	const deploymentRoots: DeploymentRoot[] = [
		{ address: settings.deployment.openOracle, name: 'openOracle' },
		{ address: settings.deployment.questionData, name: 'questionData' },
		{ address: settings.deployment.securityPoolFactory, name: 'securityPoolFactory' },
		{ address: settings.deployment.securityPoolForker, name: 'securityPoolForker' },
		{ address: settings.deployment.tradingFactory, name: 'tradingFactory' },
		{ address: settings.deployment.tradingRouter, name: 'tradingRouter' },
		{ address: settings.deployment.weth, name: 'weth' },
		{ address: settings.deployment.zoltar, name: 'zoltar' },
	]
	const deploymentAddresses = deploymentRoots.map(root => root.address)
	const logToBlock = anchor.blockNumber < settings.runtime.protocolStartBlock + BigInt(settings.runtime.protocolLogBlockSpan) - 1n ? anchor.blockNumber : settings.runtime.protocolStartBlock + BigInt(settings.runtime.protocolLogBlockSpan) - 1n
	const readerUrls = chaosReadEndpoints(settings)
	const readers = chaosReadClients(settings, pool)
	const probedReaders = await Promise.all(
		readers.map(async ({ client, endpoint }, index) => {
			const readerUrl = readerUrls[index]
			if (readerUrl === undefined) throw new Error(`RPC ${endpoint} is missing its configured URL`)
			const [finalized, codes, logs] = await Promise.all([finalizedBlockIdentity(readerUrl), Promise.all(deploymentAddresses.map(address => client.getCode({ address, blockNumber: anchor.blockNumber }))), boundedAdaptiveLogRange(client, deploymentAddresses, settings.runtime.protocolStartBlock, logToBlock)])
			const codeRoots = assertDeploymentRootCodeResults(deploymentRoots, codes, endpoint)
			return {
				client,
				finalized,
				result: {
					codeRoots,
					endpoint,
					finalizedBlock: finalized.number.toString(),
					logChunkCount: logs.chunkCount,
					logCount: logs.logCount,
					logFromBlock: settings.runtime.protocolStartBlock.toString(),
					logToBlock: logToBlock.toString(),
				},
			}
		}),
	)
	const commonFinalizedBlock = commonFreshFinalizedBlockNumber(
		anchor.blockNumber,
		probedReaders.map(reader => reader.finalized),
	)
	const [commonBlocksBeforeRecheck, initialBlocksBeforeRecheck] = await Promise.all([Promise.all(probedReaders.map(reader => reader.client.getBlock({ blockNumber: commonFinalizedBlock }))), Promise.all(probedReaders.map(reader => reader.client.getBlock({ blockNumber: reader.finalized.number })))])
	const initialCommonHash = assertCommonFinalizedBlockResults(commonFinalizedBlock, commonBlocksBeforeRecheck)
	assertFinalizedTagsMatchCommonBlock(
		commonFinalizedBlock,
		initialCommonHash,
		probedReaders.map(reader => reader.finalized),
	)
	const recheckedFinalized = await Promise.all(readerUrls.map(finalizedBlockIdentity))
	const [commonBlocksAfterRecheck, initialBlocksAfterRecheck, recheckedBlocks] = await Promise.all([
		Promise.all(probedReaders.map(reader => reader.client.getBlock({ blockNumber: commonFinalizedBlock }))),
		Promise.all(probedReaders.map(reader => reader.client.getBlock({ blockNumber: reader.finalized.number }))),
		Promise.all(
			probedReaders.map((reader, index) => {
				const checkpoint = recheckedFinalized[index]
				if (checkpoint === undefined) throw new Error('Doctor finalized-checkpoint recheck is incomplete')
				return reader.client.getBlock({ blockNumber: checkpoint.number })
			}),
		),
	])
	const stableCommonHash = assertCommonFinalizedBlockResults(commonFinalizedBlock, commonBlocksAfterRecheck)
	if (stableCommonHash !== initialCommonHash) throw new Error(`Common finalized block ${commonFinalizedBlock.toString()} changed during the launch proof`)
	assertFinalizedTagsMatchCommonBlock(commonFinalizedBlock, stableCommonHash, recheckedFinalized, 'Rechecked RPC')
	assertStableFinalizedCheckpointResults(
		probedReaders.map(reader => reader.finalized),
		initialBlocksBeforeRecheck,
		recheckedFinalized,
		initialBlocksAfterRecheck,
		recheckedBlocks,
	)
	const readerResults = probedReaders.map(reader => reader.result)
	const relayChecks = settings.submission.mode === 'private' ? (await checkPrivateTransactionSubmissionEndpoints(settings.submission, settings.network.chainId)).length : 0
	return {
		anchor: { blockHash: anchor.blockHash, blockNumber: anchor.blockNumber },
		readerResults,
		relayChecks,
		snapshot: discovery.snapshot,
	}
}

async function acquireDoctorLocks(settings: OperatorSettings) {
	try {
		return await acquireChaosProcessLocks({
			chainId: settings.network.chainId,
			execute: settings.runtime.execute,
			privateKey: settings.privateKey,
			signerLockRoot: process.env['ZOLTAR_BOT_SIGNER_LOCK_ROOT'],
			stateFile: settings.runtime.stateFile,
		})
	} catch (error) {
		if (error instanceof ChaosProcessLockAcquisitionError) {
			await error.releaseProcessLocks()
			throw error.acquisitionCause
		}
		throw error
	}
}

export async function validateDoctorCompanionState(settings: OperatorSettings) {
	const [carryProofJournal, immutableTopology] = await Promise.all([
		validateCarryProofJournalSidecarIfPresent(settings.runtime.stateFile, {
			chainId: settings.network.chainId,
			profileId: carryProofDeploymentProfileId(settings),
			securityPoolForker: settings.deployment.securityPoolForker,
			startBlock: settings.runtime.protocolStartBlock.toString(),
		}),
		validateImmutableTopologySidecarIfPresent(
			settings.runtime.stateFile,
			{
				chainId: settings.network.chainId,
				...settings.deployment,
			},
			settings.discovery,
		),
	])
	return { carryProofJournal, immutableTopology }
}

const defaultDependencies: ChaosDoctorDependencies = {
	acquireLocks: acquireDoctorLocks,
	assertProfileIsolation: assertSettingsProfileIsolation,
	load: loadSettings,
	loadState: loadDurableState,
	probe: defaultProbe,
	validateCompanionState: validateDoctorCompanionState,
	verifyStateParent,
}

function operationFamilies(settings: OperatorSettings): Record<string, { catalogDefinitions: number; enabled: boolean; liveEligibility: string }> {
	const enabled = new Set(settings.strategy.enabledEcosystems)
	return Object.fromEntries(
		CHAOS_ECOSYSTEMS.map(ecosystem => [
			ecosystem,
			{
				catalogDefinitions: CHAOS_OPERATION_CATALOG.filter(definition => definition.ecosystem === ecosystem).length,
				enabled: enabled.has(ecosystem),
				liveEligibility: 'requires completed protocol and carry indexes; doctor does not mutate those stores',
			},
		]),
	)
}

function liveFundingBlockers(settings: OperatorSettings, snapshot: ChaosDoctorProbeResult['snapshot']) {
	const blockers: string[] = []
	if (settings.privateKey === undefined) {
		if (settings.runtime.execute) blockers.push('live execution has no configured signer')
		return blockers
	}
	const required = requiredLiveInventory(settings.strategy)
	const eth = BigInt(snapshot.wallet.ethBalanceAttoEth)
	if (eth < required.ethAttoEth) blockers.push(`signer ETH ${eth.toString()} is below the reserve plus one maximum ETH principal and one gas budget ${required.ethAttoEth.toString()}`)
	const repTokens = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
	const fundedRep = snapshot.wallet.tokens.some(token => repTokens.has(token.address.toLowerCase()) && BigInt(token.balance) >= required.repAttoRep)
	if (!fundedRep) blockers.push(`no canonical REP balance meets reserve plus one maximum operation principal ${required.repAttoRep.toString()}`)
	return blockers
}

function familyReachability(settings: OperatorSettings, result: ChaosDoctorProbeResult) {
	const topologyCounts: Record<string, number> = {
		'open-oracle': result.snapshot.reports.length,
		statoblast: result.snapshot.pools.length,
		trading: result.snapshot.pairs.length,
		zoltar: result.snapshot.universes.length + result.snapshot.questions.length,
	}
	return Object.fromEntries(
		Object.entries(operationFamilies(settings)).map(([ecosystem, family]) => [
			ecosystem,
			{
				...family,
				canonicalEntityCount: topologyCounts[ecosystem] ?? 0,
				readiness: 'deployment-authenticated; exact transaction eligibility requires completed read-only indexes during paused dry-run',
			},
		]),
	)
}

function isPristineBootstrapState(state: DurableState) {
	const schedulerIsPristine = (state.scheduler.status === 'idle' || state.scheduler.status === 'paused') && state.scheduler.lastDelaySeconds === undefined && state.scheduler.lastRunAt === undefined && state.scheduler.nextRunAt === undefined && state.scheduler.selectedOperationId === undefined
	return (
		state.signerAddress === undefined &&
		state.activities.length === 0 &&
		state.lifecyclePresenceBlocker === undefined &&
		state.obligationTombstones.length === 0 &&
		state.obligations.length === 0 &&
		state.pendingTransactions.length === 0 &&
		state.protocolIndex === undefined &&
		!state.safetyPaused &&
		schedulerIsPristine &&
		state.workflows.length === 0
	)
}

export function assertDoctorDurableStateScope(settings: OperatorSettings, state: DurableState, wallet: Address | undefined, stateFile = settings.runtime.stateFile) {
	const expectedProfileId = carryProofDeploymentProfileId(settings)
	if (state.profileId !== expectedProfileId && !isPristineBootstrapState(state)) {
		throw new Error(`Durable state ${stateFile} belongs to deployment profile ${state.profileId}, expected ${expectedProfileId}`)
	}
	if (wallet !== undefined && state.signerAddress !== undefined && state.signerAddress.toLowerCase() !== wallet.toLowerCase()) {
		throw new Error(`Durable state ${stateFile} is scoped to signer ${state.signerAddress}, not ${wallet}`)
	}
	if (state.protocolIndex !== undefined) {
		const index = state.protocolIndex
		if (
			index.openOracle.toLowerCase() !== settings.deployment.openOracle.toLowerCase() ||
			index.securityPoolForker.toLowerCase() !== settings.deployment.securityPoolForker.toLowerCase() ||
			index.zoltar.toLowerCase() !== settings.deployment.zoltar.toLowerCase() ||
			index.startBlock !== settings.runtime.protocolStartBlock.toString()
		) {
			throw new Error(`Durable state ${stateFile} protocol index does not match the configured deployment roots and start block`)
		}
		const expectedIndexWallet = wallet ?? state.signerAddress ?? zeroAddress
		if (index.wallet.toLowerCase() !== expectedIndexWallet.toLowerCase()) {
			throw new Error(`Durable state ${stateFile} protocol index is scoped to wallet ${index.wallet}, not ${expectedIndexWallet}`)
		}
	}
	return {
		profile: state.profileId === expectedProfileId ? 'matched' : 'pristine-bootstrap',
		signer: state.signerAddress ?? 'not-bound',
	}
}

type LoadedDoctorSettings = Awaited<ReturnType<typeof loadSettings>>

async function runChaosDoctorWithLoaded(loaded: LoadedDoctorSettings, dependencies: ChaosDoctorDependencies) {
	await dependencies.assertProfileIsolation(loaded.path, loaded.settings)
	if (!loaded.settings.networkConfigured || loaded.settings.connectivity === undefined) throw new Error('Doctor requires a configured network and connectivity profile')
	await dependencies.verifyStateParent(loaded.settings.runtime.stateFile)
	const locks = await dependencies.acquireLocks(loaded.settings)
	try {
		const configuredSigner = loaded.settings.privateKey === undefined ? undefined : privateKeyToAccount(loaded.settings.privateKey).address
		const durableState = await dependencies.loadState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
		const durableScope = assertDoctorDurableStateScope(loaded.settings, durableState, configuredSigner)
		const companionState = await dependencies.validateCompanionState(loaded.settings)
		const probeWallet = configuredSigner ?? zeroAddress
		const result = await dependencies.probe(loaded.settings, probeWallet)
		const fundingBlockers = liveFundingBlockers(loaded.settings, result.snapshot)
		if (fundingBlockers.length !== 0) throw new Error(`Live funding readiness failed: ${fundingBlockers.join('; ')}`)
		return {
			anchor: { blockHash: result.anchor.blockHash, blockNumber: result.anchor.blockNumber.toString() },
			checks: {
				configuration: 'passed',
				companionState: 'passed',
				deploymentCodeAndGraph: 'passed',
				durableState: 'passed',
				finalizedTag: 'passed',
				processExclusivity: 'passed',
				profileIsolation: 'passed',
				protocolLogSpan: 'passed',
				relays: loaded.settings.submission.mode === 'private' ? 'passed' : 'not-required-for-public-mode',
				stateParentAccess: 'passed',
			},
			companionState,
			durableState: durableScope,
			inventory: {
				ethAttoEth: result.snapshot.wallet.ethBalanceAttoEth,
				signer: configuredSigner ?? 'not-configured',
				tokens: result.snapshot.wallet.tokens.map(token => ({ address: token.address, balance: token.balance, symbol: token.symbol })),
			},
			operationFamilies: familyReachability(loaded.settings, result),
			readers: result.readerResults,
			relayCapabilityChecks: result.relayChecks,
			topology: {
				auctions: result.snapshot.auctions.length,
				pairs: result.snapshot.pairs.length,
				pools: result.snapshot.pools.length,
				questions: result.snapshot.questions.length,
				reports: result.snapshot.reports.length,
				universes: result.snapshot.universes.length,
				warnings: [...result.snapshot.warnings],
			},
		}
	} finally {
		await locks.release()
	}
}

export async function runChaosDoctor(dependencies: ChaosDoctorDependencies = defaultDependencies) {
	return runChaosDoctorWithLoaded(await dependencies.load(), dependencies)
}

export async function runChaosLaunchGate(dependencies: ChaosDoctorDependencies = defaultDependencies) {
	const loaded = await dependencies.load()
	if (!loaded.settings.runtime.execute) {
		return {
			checks: { launchDoctor: 'not-required' },
			reason: 'persisted configuration has transaction execution disabled',
		}
	}
	return runChaosDoctorWithLoaded(loaded, dependencies)
}

async function doctorCli() {
	const argumentsAfterScript = process.argv.slice(2)
	if (argumentsAfterScript.length > 1 || (argumentsAfterScript.length === 1 && argumentsAfterScript[0] !== '--if-live-capable')) {
		throw new Error('Usage: bun src/cli/doctor.ts [--if-live-capable]')
	}
	const run = argumentsAfterScript[0] === '--if-live-capable' ? runChaosLaunchGate : runChaosDoctor
	return run()
}

if (import.meta.main) {
	doctorCli()
		.then(report => console.log(JSON.stringify(report, undefined, 2)))
		.catch(error => {
			console.error(error instanceof Error ? error.message : String(error))
			process.exitCode = 1
		})
}
