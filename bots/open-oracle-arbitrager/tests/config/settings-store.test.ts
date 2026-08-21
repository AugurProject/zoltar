import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hex } from '#ethereum'
import { assertOperatorProfileIsolation, CONFIGURATION_REVISION_CONFLICT, loadOperatorSettings, loadOperatorSettingsWithRevision, operatorProfilePath, parseOperatorSettings, saveOperatorSettings, serializeOperatorSettings, switchOperatorNetworkProfile, type OperatorSettingsFilesystem } from '#config/settings-store'
import { executorDeploymentIntentPath } from '#execution/executor-deployment-store'

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
			minimumAskDepthAttoEth: 0n,
			minimumBidDepthAttoEth: 0n,
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
		networkConfigured: true,
		paused: true,
		privateKey: privateKeyValue,
		rpcQuorum: 2 as const,
		runtime: {
			execute: false,
			historyFile: '.state/history.jsonl',
			lookbackBlocks: 256n,
			maxHedgeSlippageBps: 50n,
			once: false,
			positionFile: '.state/positions.json',
			priceHistoryFile: '.state/prices.jsonl',
			riskLimits: {
				lifecycleGasReserveAttoWeth: 10n ** 16n,
				maxConcurrentPositions: 1,
				maxDailyGasSpendAttoWeth: 5n * 10n ** 16n,
				maxPositionNotionalAttoWeth: 5n * 10n ** 18n,
				maxTotalLockedAttoWeth: 10n * 10n ** 18n,
			},
			ui: true,
			uiHost: '127.0.0.1' as const,
			uiPort: 4173,
		},
		strategy: {
			maxSpotTwapTicks: 75n,
			minimumProfitBps: 200n,
			minimumProfitAttoWeth: 25n * 10n ** 15n,
			minimumRemainingBlocks: 4n,
			minimumRemainingSeconds: 48n,
			pollMilliseconds: 15_000,
			twapSeconds: 2_400,
		},
		submission: {
			minimumBundleRelaySuccesses: 1,
			mode: 'private' as const,
			relayUrls: ['https://relay.flashbots.net/', 'https://relay.example/'],
		},
		tokenAddresses: ['0x0000000000000000000000000000000000000001' as const],
	}
}

describe('operator settings persistence', () => {
	test('keeps complete settings and durable journal paths isolated while switching chain profiles', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profiles-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		mainnet.strategy.minimumProfitBps = 777n
		mainnet.runtime.historyFile = join(directory, 'mainnet-history.jsonl')
		mainnet.runtime.positionFile = join(directory, 'mainnet-positions.json')
		mainnet.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
		await saveOperatorSettings(path, mainnet)
		const sepolia = await switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
		expect(sepolia.settings).toMatchObject({ network: 'sepolia', networkConfigured: false, paused: true, privateKey: undefined })
		expect(sepolia.settings.runtime.historyFile).toContain('.sepolia.')
		expect(sepolia.settings.runtime.positionFile).not.toBe(mainnet.runtime.positionFile)
		await saveOperatorSettings(path, { ...sepolia.settings, strategy: { ...sepolia.settings.strategy, minimumProfitBps: 333n } })
		const restored = await switchOperatorNetworkProfile(path, 'mainnet', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
		expect(restored.settings.strategy.minimumProfitBps).toBe(777n)
		expect(restored.settings.runtime.historyFile).toBe(mainnet.runtime.historyFile)
		expect(restored.settings.runtime.positionFile).toBe(mainnet.runtime.positionFile)
	})

	test('rejects a dormant profile that reuses the active chain journals', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profile-collision-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		await saveOperatorSettings(path, mainnet)
		await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), {
			...mainnet,
			centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
			network: 'sepolia',
		})
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable journal paths')
		expect(await loadOperatorSettings(path)).toMatchObject({ network: 'mainnet', runtime: { historyFile: mainnet.runtime.historyFile, positionFile: mainnet.runtime.positionFile } })
	})

	test('rejects durable journals that reuse configuration and profile files before writing', async () => {
		for (const reservedName of ['active', 'executor', 'mainnet', 'sepolia'] as const) {
			const directory = await mkdtemp(join(tmpdir(), `zoltar-arbitrager-reserved-${reservedName}-`))
			temporaryDirectories.push(directory)
			const path = join(directory, 'operator.json')
			const reservedPath = reservedName === 'active' ? path : reservedName === 'executor' ? executorDeploymentIntentPath(path) : operatorProfilePath(path, reservedName)
			const mainnet = settings(undefined)
			mainnet.runtime.historyFile = join(directory, 'mainnet-history.jsonl')
			mainnet.runtime.positionFile = join(directory, 'mainnet-positions.json')
			mainnet.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
			const sepolia = {
				...mainnet,
				centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
				network: 'sepolia' as const,
				runtime: { ...mainnet.runtime, historyFile: reservedPath, positionFile: join(directory, 'sepolia-positions.json'), priceHistoryFile: join(directory, 'sepolia-prices.jsonl') },
			}
			await saveOperatorSettings(path, mainnet)
			await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), sepolia)
			const activeBefore = await readFile(path, 'utf8')
			const targetBefore = await readFile(operatorProfilePath(path, 'sepolia'), 'utf8')
			await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Durable journal paths must not reuse configuration, profile, or executor deployment intent files')
			expect(await readFile(path, 'utf8')).toBe(activeBefore)
			expect(await readFile(operatorProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
		}
	})

	test('does not overwrite a profile file reused by the active chain as a journal', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-active-reserved-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const mainnetProfile = operatorProfilePath(path, 'mainnet')
		const active = settings(undefined)
		active.runtime.historyFile = mainnetProfile
		active.runtime.positionFile = join(directory, 'mainnet-positions.json')
		active.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
		const savedMainnet = { ...active, runtime: { ...active.runtime, historyFile: join(directory, 'mainnet-history.jsonl') } }
		const sepolia = {
			...savedMainnet,
			centralizedMarkets: { ...savedMainnet.centralizedMarkets, assetChainId: 11_155_111 },
			network: 'sepolia' as const,
			runtime: { ...savedMainnet.runtime, historyFile: join(directory, 'sepolia-history.jsonl'), positionFile: join(directory, 'sepolia-positions.json'), priceHistoryFile: join(directory, 'sepolia-prices.jsonl') },
		}
		await saveOperatorSettings(path, active)
		await saveOperatorSettings(mainnetProfile, savedMainnet)
		await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), sepolia)
		const files = [path, mainnetProfile, operatorProfilePath(path, 'sepolia')]
		const before = await Promise.all(files.map(file => readFile(file, 'utf8')))
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Durable journal paths must not reuse configuration, profile, or executor deployment intent files')
		expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(before)
	})

	test('rejects cross-chain journals reached through symlinked directory aliases', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profile-symlink-'))
		temporaryDirectories.push(directory)
		const durableDirectory = join(directory, 'durable')
		const durableAlias = join(directory, 'durable-alias')
		await mkdir(durableDirectory)
		await symlink(durableDirectory, durableAlias, 'dir')
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		mainnet.runtime.historyFile = join(durableDirectory, 'shared-history.jsonl')
		mainnet.runtime.positionFile = join(durableDirectory, 'mainnet-positions.json')
		mainnet.runtime.priceHistoryFile = join(durableDirectory, 'mainnet-prices.jsonl')
		const sepolia = {
			...mainnet,
			centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
			network: 'sepolia' as const,
			runtime: { ...mainnet.runtime, historyFile: join(durableAlias, 'shared-history.jsonl'), positionFile: join(durableAlias, 'sepolia-positions.json'), priceHistoryFile: join(durableAlias, 'sepolia-prices.jsonl') },
		}
		await saveOperatorSettings(path, mainnet)
		await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), sepolia)
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable journal paths')
		expect((await loadOperatorSettings(path))?.network).toBe('mainnet')
	})

	test('rejects cross-chain journals reached through distinct dangling symlinks to one file before writing', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profile-dangling-symlink-'))
		temporaryDirectories.push(directory)
		const sharedTarget = join(directory, 'missing-shared-history.jsonl')
		const mainnetAlias = join(directory, 'mainnet-history-alias.jsonl')
		const sepoliaAlias = join(directory, 'sepolia-history-alias.jsonl')
		await symlink(sharedTarget, mainnetAlias)
		await symlink(sharedTarget, sepoliaAlias)
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		mainnet.runtime.historyFile = mainnetAlias
		mainnet.runtime.positionFile = join(directory, 'mainnet-positions.json')
		mainnet.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
		const sepolia = {
			...mainnet,
			centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
			network: 'sepolia' as const,
			runtime: { ...mainnet.runtime, historyFile: sepoliaAlias, positionFile: join(directory, 'sepolia-positions.json'), priceHistoryFile: join(directory, 'sepolia-prices.jsonl') },
		}
		await saveOperatorSettings(path, mainnet)
		await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), sepolia)
		const files = [path, operatorProfilePath(path, 'sepolia')]
		const before = await Promise.all(files.map(file => readFile(file, 'utf8')))
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable journal paths')
		expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(before)
	})

	test('rejects a sibling profile whose embedded chain identity does not match its filename', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profile-identity-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		await saveOperatorSettings(path, mainnet)
		await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), mainnet)
		const activeBefore = await readFile(path, 'utf8')
		const targetBefore = await readFile(operatorProfilePath(path, 'sepolia'), 'utf8')
		await expect(assertOperatorProfileIsolation(path, mainnet)).rejects.toThrow('The sepolia profile contains mainnet settings')
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('The sepolia profile contains mainnet settings')
		expect(await readFile(path, 'utf8')).toBe(activeBefore)
		expect(await readFile(operatorProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
	})

	test('rejects an existing profile with a different process mode or dashboard binding before writing', async () => {
		for (const runtimeOverride of [{ once: true, ui: false }, { ui: false }, { uiHost: '0.0.0.0' as const }, { uiPort: 4999 }]) {
			const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profile-process-mode-'))
			temporaryDirectories.push(directory)
			const path = join(directory, 'operator.json')
			const mainnet = settings(undefined)
			mainnet.runtime.historyFile = join(directory, 'mainnet-history.jsonl')
			mainnet.runtime.positionFile = join(directory, 'mainnet-positions.json')
			mainnet.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
			const sepolia = {
				...mainnet,
				centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
				network: 'sepolia' as const,
				runtime: { ...mainnet.runtime, ...runtimeOverride, historyFile: join(directory, 'sepolia-history.jsonl'), positionFile: join(directory, 'sepolia-positions.json'), priceHistoryFile: join(directory, 'sepolia-prices.jsonl') },
			}
			await saveOperatorSettings(path, mainnet)
			await saveOperatorSettings(operatorProfilePath(path, 'sepolia'), sepolia)
			const activeBefore = await readFile(path, 'utf8')
			const targetBefore = await readFile(operatorProfilePath(path, 'sepolia'), 'utf8')
			await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Chain profiles must use the same once mode and dashboard binding to switch in place')
			expect(await readFile(path, 'utf8')).toBe(activeBefore)
			expect(await readFile(operatorProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
		}
	})

	test('defaults existing configuration files to the primary-reader RPC policy', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		delete serialized.rpcQuorum
		expect(parseOperatorSettings(serialized).rpcQuorum).toBe(1)
	})

	test('validates and persists the dashboard RPC quorum policy', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		for (const rpcQuorum of [null, '1', 0, 3]) expect(() => parseOperatorSettings({ ...serialized, rpcQuorum })).toThrow('rpcQuorum must be 1 or 2')
		expect(parseOperatorSettings({ ...serialized, rpcQuorum: 1 }).rpcQuorum).toBe(1)
	})

	test('permits live execution with only the primary read RPC by default', () => {
		const value = settings(privateKey)
		const serialized = serializeOperatorSettings({ ...value, deployment: { ...value.deployment, quorumRpcUrls: [] }, rpcQuorum: 1 })
		const parsed = parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, execute: true } })
		expect(parsed.deployment.quorumRpcUrls).toEqual([])
	})

	test('requires independent readers when the two-reader policy is explicitly enabled', () => {
		const value = settings(privateKey)
		const serialized = serializeOperatorSettings({ ...value, deployment: { ...value.deployment, quorumRpcUrls: [] }, rpcQuorum: 2 })
		expect(() => parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, execute: true } })).toThrow('at least two independent quorum RPCs')
	})

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

	test('bounds coordinator-free event discovery to the latest 0 through 256 blocks', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		for (const lookbackBlocks of ['0', '256']) expect(parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, lookbackBlocks } }).runtime.lookbackBlocks).toBe(BigInt(lookbackBlocks))
		expect(parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, lookbackBlocks: '50000' } }).runtime.lookbackBlocks).toBe(256n)
		expect(() => parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, lookbackBlocks: '-1' } })).toThrow('Runtime lookbackBlocks must be a nonnegative integer string')
		expect(() => parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, lookbackBlocks: '257' } })).toThrow('Runtime lookbackBlocks must be from 0 through 256')
	})

	test('rejects persistent runtime files that resolve to the same path', () => {
		const value = settings(undefined)
		expect(() =>
			parseOperatorSettings(
				serializeOperatorSettings({
					...value,
					runtime: { ...value.runtime, positionFile: '.state/shared.jsonl', priceHistoryFile: '.state/nested/../shared.jsonl' },
				}),
			),
		).toThrow('must use distinct paths')
	})
})
