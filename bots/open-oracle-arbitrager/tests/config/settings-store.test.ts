import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hex } from '#ethereum'
import { CONFIGURATION_REVISION_CONFLICT, loadOperatorSettings, loadOperatorSettingsWithRevision, saveOperatorSettings, type OperatorSettingsFilesystem } from '#config/settings-store'

const temporaryDirectories: string[] = []
const privateKey = `0x${'11'.repeat(32)}` as Hex

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

function settings(privateKeyValue: Hex | undefined) {
	return {
		centralizedMarkets: {
			assetAddress: '0x0000000000000000000000000000000000000005' as const,
			assetChainId: 1,
			assetSymbol: 'REP',
			depthBps: 500n,
			maximumDexDeviationBps: 1_000n,
			maximumObservationAgeMilliseconds: 30_000,
			maximumVenueDispersionBps: 500n,
			minimumAskDepthEth: 0n,
			minimumBidDepthEth: 0n,
			minimumSourceCount: 1,
			orderBookLimit: 20,
			requestTimeoutMilliseconds: 5_000,
			requiredForExecution: false,
			sources: [],
		},
		connectivity: {
			publicRpcUrls: ['https://submit-one.example/', 'https://submit-two.example/'],
			readRpcUrl: 'https://read.example/',
		},
		deployment: {
			coordinatorAddresses: ['0x0000000000000000000000000000000000000002' as const],
			deploymentManifest: undefined,
			executor: '0x0000000000000000000000000000000000000003' as const,
			openOracle: '0x0000000000000000000000000000000000000004' as const,
			quorumRpcUrls: ['https://quorum.example/'],
			rep: '0x0000000000000000000000000000000000000005' as const,
			uniswapFactory: '0x0000000000000000000000000000000000000006' as const,
			uniswapQuoter: '0x0000000000000000000000000000000000000007' as const,
			uniswapRouter: '0x0000000000000000000000000000000000000008' as const,
			uniswapV2Router: undefined,
			uniswapV4PoolManager: undefined,
			uniswapV4Quoter: undefined,
			weth: '0x0000000000000000000000000000000000000009' as const,
		},
		network: 'mainnet' as const,
		paused: true,
		privateKey: privateKeyValue,
		runtime: {
			execute: false,
			historyFile: '.state/history.jsonl',
			lookbackBlocks: 50_000n,
			maxHedgeSlippageBps: 50n,
			once: false,
			positionFile: '.state/positions.json',
			priceHistoryFile: '.state/prices.jsonl',
			riskLimits: {
				lifecycleGasReserveWeth: 10n ** 16n,
				maxConcurrentPositions: 1,
				maxDailyGasSpendWeth: 5n * 10n ** 16n,
				maxPositionNotionalWeth: 5n * 10n ** 18n,
				maxTotalLockedWeth: 10n * 10n ** 18n,
			},
			ui: true,
			uiHost: '127.0.0.1' as const,
			uiPort: 4173,
		},
		strategy: {
			maxSpotTwapTicks: 75n,
			minimumProfitBps: 200n,
			minimumProfitWeth: 25n * 10n ** 15n,
			minimumRemainingBlocks: 4n,
			minimumRemainingSeconds: 48n,
			pollMilliseconds: 15_000,
			twapSeconds: 2_400,
		},
		submission: {
			minimumRelaySuccesses: 2,
			mode: 'private' as const,
			relayUrls: ['https://relay.flashbots.net/', 'https://relay.example/'],
		},
		tokenAddresses: ['0x0000000000000000000000000000000000000001' as const],
	}
}

describe('operator settings persistence', () => {
	test('syncs settings contents and the parent directory before returning success', async () => {
		const events: string[] = []
		let opened = 0
		const filesystem: OperatorSettingsFilesystem = {
			mkdir: async () => events.push('mkdir'),
			open: async (_path, flags) => {
				opened++
				if (flags === 'wx') {
					return {
						chmod: async () => events.push('file:chmod'),
						close: async () => events.push('file:close'),
						sync: async () => events.push('file:sync'),
						writeFile: async () => events.push('file:write'),
					}
				}
				return {
					chmod: async () => {
						throw new Error('directory chmod is unexpected')
					},
					close: async () => events.push('directory:close'),
					sync: async () => events.push('directory:sync'),
					writeFile: async () => {
						throw new Error('directory write is unexpected')
					},
				}
			},
			readFile: async () => {
				throw new Error('read is unexpected')
			},
			rename: async () => events.push('rename'),
			rm: async () => events.push('rm'),
		}
		await saveOperatorSettings('/operator/settings.json', settings(undefined), filesystem)
		expect(opened).toBe(2)
		expect(events).toEqual(['mkdir', 'file:write', 'file:chmod', 'file:sync', 'file:close', 'rename', 'directory:sync', 'directory:close'])
	})

	test('atomically round-trips restart settings with owner-only permissions', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'nested', 'settings.json')
		await saveOperatorSettings(path, settings(privateKey))
		expect((await stat(path)).mode & 0o777).toBe(0o600)
		expect(await loadOperatorSettings(path)).toEqual(settings(privateKey))
	})

	test('checks the expected revision at commit and returns the revision of the exact saved bytes', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		await saveOperatorSettings(path, settings(undefined))
		const loaded = await loadOperatorSettingsWithRevision(path)
		if (loaded === undefined) throw new Error('Expected saved operator settings')
		const next = { ...settings(undefined), paused: false }
		const savedRevision = await saveOperatorSettings(path, next, undefined, loaded.revision)
		expect((await loadOperatorSettingsWithRevision(path))?.revision).toBe(savedRevision)

		const current = await loadOperatorSettingsWithRevision(path)
		if (current === undefined) throw new Error('Expected saved operator settings')
		let replacedBeforeCommit = false
		const filesystem: OperatorSettingsFilesystem = {
			mkdir,
			open,
			readFile: async (readPath, encoding) => {
				if (readPath === path && !replacedBeforeCommit) {
					replacedBeforeCommit = true
					const external = (await readFile(path, 'utf8')).replace('"paused": false', '"paused": true')
					await writeFile(path, external, 'utf8')
				}
				return readFile(readPath, encoding)
			},
			rename,
			rm,
		}
		const conflict = saveOperatorSettings(path, { ...next, runtime: { ...next.runtime, uiPort: 4180 } }, filesystem, current.revision)
		await expect(conflict).rejects.toMatchObject({ name: CONFIGURATION_REVISION_CONFLICT })
		expect((await loadOperatorSettings(path))?.paused).toBe(true)
		expect((await loadOperatorSettings(path))?.runtime.uiPort).toBe(4173)
	})

	test('does not write an unremembered signer and removes a previously remembered signer', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		await saveOperatorSettings(path, settings(privateKey))
		await saveOperatorSettings(path, settings(undefined))
		const contents = await readFile(path, 'utf8')
		expect(contents).not.toContain(privateKey)
		expect(await loadOperatorSettings(path)).toEqual(settings(undefined))
	})

	test('fails closed for malformed, unknown, or unsupported settings', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		expect(await loadOperatorSettings(path)).toBeUndefined()
		await writeFile(path, 'not json', 'utf8')
		expect(loadOperatorSettings(path)).rejects.toThrow('not valid JSON')
		await saveOperatorSettings(path, settings(undefined))
		const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
		await writeFile(path, JSON.stringify({ ...parsed, unexpected: true }), 'utf8')
		expect(loadOperatorSettings(path)).rejects.toThrow('Unknown operator configuration field')
		await writeFile(path, JSON.stringify({ ...parsed, version: 3 }), 'utf8')
		expect(loadOperatorSettings(path)).rejects.toThrow('unsupported version')
	})
})
