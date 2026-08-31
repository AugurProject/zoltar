import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import {
	assertCommonFinalizedBlockResults,
	assertDeploymentRootCodeResults,
	assertDoctorDurableStateScope,
	assertFinalizedTagsMatchCommonBlock,
	assertStableFinalizedCheckpointResults,
	boundedAdaptiveLogRange,
	commonFreshFinalizedBlockNumber,
	runChaosDoctor,
	runChaosLaunchGate,
	validateDoctorCompanionState,
	type ChaosDoctorDependencies,
	type ChaosDoctorProbeResult,
} from '../../src/cli/doctor.ts'
import { MINIMUM_WORKFLOW_VALIDITY_BLOCKS, parseSettings } from '../../src/config/settings.ts'
import { carryProofJournalSidecarPath } from '../../src/monitoring/carry-proof-journal.ts'
import { carryProofDeploymentProfileId } from '../../src/monitoring/carry-proof-scan.ts'
import { immutableTopologySidecarDirectory } from '../../src/monitoring/topology-cache.ts'
import { initialDurableState, loadDurableState, serializedDurableState } from '../../src/state/operator-state.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function settingsFixture(name: 'operator.configured-placeholder.json' | 'operator.example.json') {
	const value: unknown = JSON.parse(await readFile(join(import.meta.dir, '..', '..', 'config', name), 'utf8'))
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected settings fixture object')
	const strategy = Reflect.get(value, 'strategy')
	if (typeof strategy !== 'object' || strategy === null || Array.isArray(strategy)) throw new Error('Expected settings strategy fixture')
	Reflect.set(strategy, 'workflowValidForBlocks', Number(MINIMUM_WORKFLOW_VALIDITY_BLOCKS))
	return parseSettings(value)
}

const probeResult: ChaosDoctorProbeResult = {
	anchor: { blockHash: `0x${'11'.repeat(32)}`, blockNumber: 100n },
	readerResults: [{ codeRoots: 8, endpoint: 'https://reader.example', finalizedBlock: '90', logChunkCount: 1, logCount: 3, logFromBlock: '50', logToBlock: '100' }],
	relayChecks: 0,
	snapshot: {
		auctions: [],
		pairs: [],
		pools: [],
		questions: [],
		reports: [],
		universes: [{ id: '0', repToken: '0x0000000000000000000000000000000000000001' }],
		wallet: { ethBalanceAttoEth: 123n.toString(), tokens: [{ address: '0x0000000000000000000000000000000000000001', balance: '456', symbol: 'REP' }] },
		warnings: [],
	},
}

function passiveDoctorDependencies(settings: Awaited<ReturnType<typeof settingsFixture>>, overrides: Partial<ChaosDoctorDependencies> = {}): ChaosDoctorDependencies {
	return {
		acquireLocks: async () => ({ release: async () => undefined }),
		assertProfileIsolation: async () => undefined,
		load: async () => ({ path: '/private/operator.json', revision: 'sha256:test', settings }),
		loadState: async (_path, chainId) => initialDurableState(chainId, true, carryProofDeploymentProfileId(settings)),
		probe: async () => probeResult,
		validateCompanionState: async () => ({ carryProofJournal: 'absent', immutableTopology: 'absent' }),
		verifyStateParent: async () => undefined,
		...overrides,
	}
}

describe('chaos launch doctor', () => {
	test('requires fresh finalized checkpoints and a shared canonical identity', () => {
		const firstHash = `0x${'11'.repeat(32)}`
		const secondHash = `0x${'22'.repeat(32)}`
		const thirdHash = `0x${'33'.repeat(32)}`
		expect(
			commonFreshFinalizedBlockNumber(1_000n, [
				{ hash: firstHash, number: 930n },
				{ hash: secondHash, number: 940n },
			]),
		).toBe(930n)
		expect(() => commonFreshFinalizedBlockNumber(1_000n, [{ hash: firstHash, number: 903n }])).toThrow('exceeding the 96-block launch limit')
		expect(() => commonFreshFinalizedBlockNumber(1_000n, [{ hash: firstHash, number: 1_001n }])).toThrow('ahead of the quorum anchor')
		expect(
			assertCommonFinalizedBlockResults(930n, [
				{ hash: firstHash, number: 930n },
				{ hash: firstHash.toUpperCase().replace('0X', '0x'), number: 930n },
			]),
		).toBe(firstHash)
		expect(() =>
			assertCommonFinalizedBlockResults(930n, [
				{ hash: firstHash, number: 930n },
				{ hash: secondHash, number: 930n },
			]),
		).toThrow('disagree on common finalized block')
		expect(() => assertFinalizedTagsMatchCommonBlock(930n, thirdHash, [{ hash: firstHash, number: 930n }])).toThrow('finalized-tag hash does not match common finalized block 930')
		expect(() =>
			assertStableFinalizedCheckpointResults(
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 940n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 940n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: thirdHash, number: 941n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 940n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: thirdHash, number: 941n },
				],
			),
		).not.toThrow()
		expect(() =>
			assertStableFinalizedCheckpointResults(
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 940n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 940n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: thirdHash, number: 941n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: thirdHash, number: 940n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: thirdHash, number: 941n },
				],
			),
		).toThrow('changed after the finalized-tag recheck')
		expect(() =>
			assertStableFinalizedCheckpointResults(
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 930n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 930n },
				],
				[
					{ hash: thirdHash, number: 931n },
					{ hash: thirdHash, number: 931n },
				],
				[
					{ hash: firstHash, number: 930n },
					{ hash: secondHash, number: 930n },
				],
				[
					{ hash: thirdHash, number: 931n },
					{ hash: thirdHash, number: 931n },
				],
			),
		).toThrow('disagree on initial finalized-tag block 930')
		expect(() => assertStableFinalizedCheckpointResults([{ hash: firstHash, number: 930n }], [{ hash: firstHash, number: 930n }], [{ hash: firstHash, number: 929n }], [{ hash: firstHash, number: 930n }], [{ hash: firstHash, number: 929n }])).toThrow('regressed')
	})

	test('fails closed when either configured trading root has no bytecode', () => {
		const roots = [
			{ address: '0x0000000000000000000000000000000000000001' as const, name: 'tradingFactory' },
			{ address: '0x0000000000000000000000000000000000000002' as const, name: 'tradingRouter' },
		]
		expect(() => assertDeploymentRootCodeResults(roots, ['0x1234', '0x'], 'https://reader.example')).toThrow('tradingRouter')
	})

	test('does not subdivide non-range log failures and fails an oversized single block', async () => {
		let outageCalls = 0
		const outageClient = {
			getLogs: async () => {
				outageCalls += 1
				throw new Error('HTTP 401 while calling eth_getLogs')
			},
		}
		await expect(boundedAdaptiveLogRange(outageClient, ['0x0000000000000000000000000000000000000001'], 0n, 255n)).rejects.toThrow('HTTP 401')
		expect(outageCalls).toBe(1)

		let oversizedCalls = 0
		const oversizedClient = {
			getLogs: async () => {
				oversizedCalls += 1
				throw new Error('query returned more than 10000 results')
			},
		}
		await expect(boundedAdaptiveLogRange(oversizedClient, ['0x0000000000000000000000000000000000000001'], 7n, 7n)).rejects.toThrow('blocks 7 through 7')
		expect(oversizedCalls).toBe(1)
	})

	test('returns a read-only launch report without requiring a signer', async () => {
		const settings = await settingsFixture('operator.configured-placeholder.json')
		let profileChecked = false
		let stateParentChecked = false
		let locksReleased = false
		let probedWallet = ''
		const dependencies = passiveDoctorDependencies(settings, {
			acquireLocks: async () => ({
				release: async () => {
					locksReleased = true
				},
			}),
			assertProfileIsolation: async () => {
				profileChecked = true
			},
			probe: async (_settings, wallet) => {
				probedWallet = wallet
				return probeResult
			},
			verifyStateParent: async () => {
				stateParentChecked = true
			},
		})

		const report = await runChaosDoctor(dependencies)
		expect(profileChecked).toBe(true)
		expect(stateParentChecked).toBe(true)
		expect(locksReleased).toBe(true)
		expect(probedWallet).toBe('0x0000000000000000000000000000000000000000')
		expect(report).toMatchObject({
			checks: { configuration: 'passed', deploymentCodeAndGraph: 'passed', finalizedTag: 'passed', protocolLogSpan: 'passed' },
			inventory: { ethAttoEth: 123n.toString(), signer: 'not-configured' },
			topology: { universes: 1 },
		})
		expect(Object.keys(report.operationFamilies).sort()).toEqual(['open-oracle', 'statoblast', 'trading', 'zoltar'])
	})

	test('fails before network probes when configuration is still a placeholder', async () => {
		const settings = await settingsFixture('operator.example.json')
		let probed = false
		const dependencies = passiveDoctorDependencies(settings, {
			probe: async () => {
				probed = true
				return probeResult
			},
		})

		await expect(runChaosDoctor(dependencies)).rejects.toThrow('configured network and connectivity profile')
		expect(probed).toBe(false)
	})

	test('fails closed when live signer funding is below configured reserves', async () => {
		const baseline = await settingsFixture('operator.configured-placeholder.json')
		const settings = { ...baseline, privateKey: `0x${'22'.repeat(32)}` as const, runtime: { ...baseline.runtime, execute: true } }
		const dependencies = passiveDoctorDependencies(settings, {
			probe: async () => probeResult,
		})

		await expect(runChaosDoctor(dependencies)).rejects.toThrow('signer ETH')
	})

	test('fails before durable-state or network reads when another operator owns a required lock', async () => {
		const settings = await settingsFixture('operator.configured-placeholder.json')
		let stateLoaded = false
		let probed = false
		const dependencies = passiveDoctorDependencies(settings, {
			acquireLocks: async () => {
				throw new Error('Chaos-bot state is already locked by pid 42')
			},
			loadState: async () => {
				stateLoaded = true
				return initialDurableState(settings.network.chainId)
			},
			probe: async () => {
				probed = true
				return probeResult
			},
		})

		await expect(runChaosDoctor(dependencies)).rejects.toThrow('already locked')
		expect(stateLoaded).toBe(false)
		expect(probed).toBe(false)
	})

	test('validates deployment profile and signer scope without mutating state', async () => {
		const baseline = await settingsFixture('operator.configured-placeholder.json')
		const privateKey = `0x${'44'.repeat(32)}` as const
		const settings = { ...baseline, privateKey }
		const wallet = privateKeyToAccount(privateKey).address
		const wrongProfile = initialDurableState(settings.network.chainId, true, 'profile:wrong')
		wrongProfile.activities.push({ at: new Date(0).toISOString(), message: 'existing history', status: 'info', type: 'configuration' })
		expect(() => assertDoctorDurableStateScope(settings, wrongProfile, wallet, '/state.json')).toThrow('belongs to deployment profile')

		const wrongSigner = initialDurableState(settings.network.chainId, true, carryProofDeploymentProfileId(settings), privateKeyToAccount(`0x${'55'.repeat(32)}`).address)
		expect(() => assertDoctorDurableStateScope(settings, wrongSigner, wallet, '/state.json')).toThrow('scoped to signer')

		const wrongIndex = initialDurableState(settings.network.chainId, true, carryProofDeploymentProfileId(settings), wallet)
		wrongIndex.protocolIndex = {
			auctionBids: {},
			auctionRefunds: {},
			chainId: settings.network.chainId,
			childRepSplits: [],
			cursor: { blockHash: `0x${'11'.repeat(32)}`, blockNumber: settings.runtime.protocolStartBlock.toString() },
			escalationDeposits: [],
			migrationRepSplits: [],
			openOracle: privateKeyToAccount(`0x${'77'.repeat(32)}`).address,
			reports: [],
			schemaVersion: 3,
			securityPoolForker: settings.deployment.securityPoolForker,
			startBlock: settings.runtime.protocolStartBlock.toString(),
			wallet,
			zoltar: settings.deployment.zoltar,
		}
		expect(() => assertDoctorDurableStateScope(settings, wrongIndex, wallet, '/state.json')).toThrow('protocol index does not match')

		const pristine = initialDurableState(settings.network.chainId)
		expect(assertDoctorDurableStateScope(settings, pristine, wallet, '/state.json').profile).toBe('pristine-bootstrap')
	})

	test('loads the complete durable journal and fails when its committed index generation is missing', async () => {
		const baseline = await settingsFixture('operator.configured-placeholder.json')
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-doctor-state-'))
		temporaryDirectories.push(directory)
		await chmod(directory, 0o700)
		const stateFile = join(directory, 'state.json')
		const settings = { ...baseline, runtime: { ...baseline.runtime, stateFile } }
		const state = initialDurableState(settings.network.chainId, true, carryProofDeploymentProfileId(settings))
		const missingReference = { kind: 'protocol-index-sidecar' as const, manifestDigest: `0x${'aa'.repeat(32)}` as const, schemaVersion: 1 as const }
		await writeFile(stateFile, `${JSON.stringify(serializedDurableState(state, missingReference))}\n`, { mode: 0o600 })
		let locksReleased = false
		let probed = false
		const dependencies = passiveDoctorDependencies(settings, {
			acquireLocks: async () => ({
				release: async () => {
					locksReleased = true
				},
			}),
			loadState: loadDurableState,
			probe: async () => {
				probed = true
				return probeResult
			},
		})

		await expect(runChaosDoctor(dependencies)).rejects.toThrow()
		expect(locksReleased).toBe(true)
		expect(probed).toBe(false)
	})

	test('loads and rejects malformed durable journal JSON before probing the network', async () => {
		const baseline = await settingsFixture('operator.configured-placeholder.json')
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-doctor-malformed-'))
		temporaryDirectories.push(directory)
		await chmod(directory, 0o700)
		const stateFile = join(directory, 'state.json')
		const settings = { ...baseline, runtime: { ...baseline.runtime, stateFile } }
		await writeFile(stateFile, '{', { mode: 0o600 })
		let probed = false
		const dependencies = passiveDoctorDependencies(settings, {
			loadState: loadDurableState,
			probe: async () => {
				probed = true
				return probeResult
			},
		})

		await expect(runChaosDoctor(dependencies)).rejects.toThrow('not valid JSON')
		expect(probed).toBe(false)
	})

	test('authenticates existing carry-journal and topology companions before probing the network', async () => {
		const baseline = await settingsFixture('operator.configured-placeholder.json')
		for (const companion of ['carry', 'topology'] as const) {
			const directory = await mkdtemp(join(tmpdir(), `zoltar-chaos-doctor-${companion}-`))
			temporaryDirectories.push(directory)
			await chmod(directory, 0o700)
			const stateFile = join(directory, 'state.json')
			const settings = { ...baseline, runtime: { ...baseline.runtime, stateFile } }
			if (companion === 'carry') {
				await writeFile(carryProofJournalSidecarPath(stateFile), '{', { mode: 0o600 })
			} else {
				const store = immutableTopologySidecarDirectory(stateFile)
				await mkdir(store, { mode: 0o700 })
				await writeFile(join(store, 'current.json'), '{', { mode: 0o600 })
			}
			let probed = false
			const dependencies = passiveDoctorDependencies(settings, {
				probe: async () => {
					probed = true
					return probeResult
				},
				validateCompanionState: validateDoctorCompanionState,
			})

			await expect(runChaosDoctor(dependencies)).rejects.toThrow('not valid JSON')
			expect(probed).toBe(false)
		}
	})

	test('skips the startup gate for a paused first-boot template and enforces it for persisted live execution', async () => {
		const pausedSettings = await settingsFixture('operator.example.json')
		let pausedLocks = 0
		let pausedProbes = 0
		const skipped = await runChaosLaunchGate(
			passiveDoctorDependencies(pausedSettings, {
				acquireLocks: async () => {
					pausedLocks += 1
					return { release: async () => undefined }
				},
				probe: async () => {
					pausedProbes += 1
					return probeResult
				},
			}),
		)
		expect(skipped).toMatchObject({ checks: { launchDoctor: 'not-required' } })
		expect(pausedLocks).toBe(0)
		expect(pausedProbes).toBe(0)

		const configuredSettings = await settingsFixture('operator.configured-placeholder.json')
		const privateKey = `0x${'66'.repeat(32)}` as const
		const liveSettings = { ...configuredSettings, paused: false, privateKey, runtime: { ...configuredSettings.runtime, execute: true } }
		let liveLocks = 0
		let liveProbes = 0
		const fundedProbeResult: ChaosDoctorProbeResult = {
			...probeResult,
			snapshot: {
				...probeResult.snapshot,
				wallet: {
					ethBalanceAttoEth: (10n ** 30n).toString(),
					tokens: [{ address: probeResult.snapshot.universes[0]?.repToken ?? '0x0000000000000000000000000000000000000001', balance: (10n ** 30n).toString(), symbol: 'REP' }],
				},
			},
		}
		const report = await runChaosLaunchGate(
			passiveDoctorDependencies(liveSettings, {
				acquireLocks: async () => {
					liveLocks += 1
					return { release: async () => undefined }
				},
				probe: async () => {
					liveProbes += 1
					return fundedProbeResult
				},
			}),
		)
		expect(report).toMatchObject({ checks: { durableState: 'passed', processExclusivity: 'passed' } })
		expect(liveLocks).toBe(1)
		expect(liveProbes).toBe(1)
	})
})
