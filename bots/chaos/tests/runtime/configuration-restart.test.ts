import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { keccak256, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import example from '../../config/operator.example.json'
import { loadSettings, parseSettings, saveSettings, serializedSettings } from '../../src/config/settings.ts'
import { createChaosDashboardController, type DashboardControllerOptions } from '../../src/runtime/dashboard-controller.ts'
import { initialDurableState, initialRuntimeState } from '../../src/state/initial-state.ts'
import { executionProfileId } from '../../src/config/execution-profile.ts'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { editableSettings } from '../../src/runtime/complete-settings.ts'
import { ConfigurationCommitIndeterminate } from '../../src/runtime/configuration-commit.ts'
import { acquireFileProcessLock } from '@zoltar/bot-shared/execution/process-lock'
import type { RestartConfiguration } from '../../src/runtime/configuration-restart.ts'
import { loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'

const firstKey: Hex = `0x${'11'.repeat(32)}`
const secondKey: Hex = `0x${'22'.repeat(32)}`

async function withController(run: (context: Awaited<ReturnType<typeof fixture>>) => Promise<void>, overrides: Partial<DashboardControllerOptions> = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'chaos-ui-config-'))
	try {
		await run(await fixture(directory, overrides))
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

async function fixture(directory: string, overrides: Partial<DashboardControllerOptions>) {
	const settings = parseSettings({ ...example, privateKey: firstKey, runtime: { ...example.runtime, stateFile: join(directory, 'old.json') } })
	const address = privateKeyToAccount(firstKey).address
	const state = initialRuntimeState(true, address, settings.network.chainId, initialDurableState(settings.network.chainId, true, executionProfileId(settings), address))
	state.uniswapV3Factory = settings.deployment.uniswapV3Factory
	await saveDurableState(settings.runtime.stateFile, state)
	const path = join(directory, 'operator.json')
	const revision = await saveSettings(path, settings)
	const configuration = { path, revision, settings, rememberSigner: true }
	const gate = createSignerOperationGate()
	let next: RestartConfiguration | undefined
	const controller = createChaosDashboardController({
		configuration,
		gate,
		state,
		hostname: '127.0.0.1',
		locks: { acquireSigner: async () => undefined, commitSigner: async () => undefined, discardSigner: async () => undefined, release: async () => undefined },
		onRestartRequested: value => {
			next = value
		},
		...overrides,
	})
	if (controller.setConfigurationDocument === undefined) throw new Error('Missing complete configuration control')
	const completeController = { ...controller, setConfigurationDocument: controller.setConfigurationDocument }
	return { directory, configuration, state, controller: completeController, settings, revision, gate, next: () => next }
}

describe('UI configuration restart', () => {
	test('switches a bound signer from the UI while preserving the old state and staying paused and dry', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-ui-config-'))
		try {
			const settings = parseSettings({ ...example, privateKey: firstKey, runtime: { ...example.runtime, stateFile: join(directory, 'old.json') } })
			const address = privateKeyToAccount(firstKey).address
			const state = initialRuntimeState(true, address, settings.network.chainId, initialDurableState(settings.network.chainId, true, executionProfileId(settings), address))
			state.uniswapV3Factory = settings.deployment.uniswapV3Factory
			await saveDurableState(settings.runtime.stateFile, state)
			const path = join(directory, 'operator.json')
			const revision = await saveSettings(path, settings)
			let restarted = false
			const options = {
				configuration: { path, revision, settings, rememberSigner: true },
				gate: createSignerOperationGate(),
				hostname: '127.0.0.1',
				locks: { acquireSigner: async () => undefined, commitSigner: async () => undefined, discardSigner: async () => undefined, release: async () => undefined },
				state,
				onRestartRequested: () => {
					restarted = true
				},
			} satisfies DashboardControllerOptions
			const controller = createChaosDashboardController(options)
			await controller.setSigner({ privateKey: secondKey, remember: true, revision })
			const saved = await loadSettings(path)
			expect(restarted).toBe(true)
			expect(saved.settings.privateKey).toBe(secondKey)
			expect(saved.settings.runtime.stateFile).not.toBe(settings.runtime.stateFile)
			expect(saved.settings.paused).toBe(true)
			expect(saved.settings.runtime.execute).toBe(false)
			expect((await loadDurableState(settings.runtime.stateFile, settings.network.chainId)).signerAddress).toBe(address)
			expect((await loadDurableState(saved.settings.runtime.stateFile, settings.network.chainId)).signerAddress).toBe(privateKeyToAccount(secondKey).address)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
	test('keeps memory-only replacement keys out of the saved configuration and archives', async () => {
		await withController(async ({ controller, configuration, revision, next, directory }) => {
			configuration.rememberSigner = false
			await controller.setSigner({ privateKey: secondKey, remember: false, revision })
			expect(next()?.settings.privateKey).toBe(secondKey)
			expect(next()?.rememberSigner).toBe(false)
			expect((await loadSettings(configuration.path)).settings.privateKey).toBeUndefined()
			const archive = (await readdir(directory)).find(name => name.includes('.retired-'))
			if (archive === undefined) throw new Error('Missing preserved configuration')
			expect(archive.startsWith('operator.json.retired-')).toBe(true)
			expect(await readFile(join(directory, archive), 'utf8')).not.toContain(firstKey)
			expect(await readFile(join(directory, archive), 'utf8')).not.toContain(secondKey)
		})
	})

	test('saves fields omitted by the original settings UI and regenerates contract identities', async () => {
		await withController(async ({ controller, configuration, settings, revision, next }) => {
			const document = editableSettings(settings)
			document.discovery.maxPools = 99
			document.runtime.protocolLogBlockSpan = 1000
			document.runtime.uiPort = 4194
			document.network.maximumBlockIntervalSeconds = 61
			document.deploymentPin.openOracle = '0x0000000000000000000000000000000000000001'
			await controller.setConfigurationDocument({ settings: document, revision })
			const saved = (await loadSettings(configuration.path)).settings
			expect(saved.discovery.maxPools).toBe(99)
			expect(saved.runtime.protocolLogBlockSpan).toBe(1000)
			expect(saved.runtime.uiPort).toBe(4194)
			expect(saved.network.maximumBlockIntervalSeconds).toBe(61)
			expect(executionProfileId(saved)).not.toBe(executionProfileId(settings))
			expect(saved.runtime.stateFile).not.toBe(settings.runtime.stateFile)
			expect(next()?.settings).toEqual(saved)
		})
	})

	test('restarts ordinary full configuration changes on the same state path and preserves recovery history', async () => {
		await withController(async ({ controller, configuration, settings, state, revision }) => {
			state.activities.push({ at: new Date().toISOString(), message: 'existing history', status: 'info', type: 'configuration' })
			const document = editableSettings(settings)
			document.runtime.pollMilliseconds = 13000
			await controller.setConfigurationDocument({ settings: document, revision })
			const saved = (await loadSettings(configuration.path)).settings
			expect(saved.runtime.stateFile).toBe(settings.runtime.stateFile)
			expect((await loadDurableState(saved.runtime.stateFile, saved.network.chainId)).activities[0]?.message).toBe('existing history')
		})
	})

	test('rejects stale revisions and running edits without saving or queuing restart', async () => {
		await withController(async ({ controller, configuration, settings, state, revision, next }) => {
			const before = await readFile(configuration.path, 'utf8')
			await expect(controller.setConfigurationDocument({ settings: editableSettings(settings), revision: 'stale' })).rejects.toThrow('changed')
			state.paused = false
			await expect(controller.setSigner({ privateKey: secondKey, remember: true, revision })).rejects.toThrow('Pause')
			expect(next()).toBeUndefined()
			expect(await readFile(configuration.path, 'utf8')).toBe(before)
		})
	})

	test('rejects a replacement state path already held by another process', async () => {
		await withController(async ({ directory, controller, settings, configuration, revision, next }) => {
			const document = editableSettings(settings)
			document.runtime.stateFile = join(directory, 'other.json')
			const lock = await acquireFileProcessLock(document.runtime.stateFile, 'test owner')
			try {
				await expect(controller.setConfigurationDocument({ settings: document, revision })).rejects.toThrow('already locked')
				expect(next()).toBeUndefined()
				expect((await loadSettings(configuration.path)).settings.runtime.stateFile).toBe(settings.runtime.stateFile)
			} finally {
				await lock.release()
			}
		})
	})

	test('rejects an existing target state owned by a different signer', async () => {
		await withController(async ({ directory, controller, settings, state, revision, next }) => {
			const document = editableSettings(settings)
			document.runtime.stateFile = join(directory, 'other.json')
			const other = { ...state, signerAddress: privateKeyToAccount(secondKey).address }
			await saveDurableState(document.runtime.stateFile, other)
			const before = await readFile(document.runtime.stateFile, 'utf8')
			await expect(controller.setConfigurationDocument({ settings: document, revision })).rejects.toThrow('scoped to signer')
			expect(next()).toBeUndefined()
			expect(await readFile(document.runtime.stateFile, 'utf8')).toBe(before)
		})
	})

	test('keeps new requests blocked until restart completes', async () => {
		await withController(async ({ controller, revision }) => {
			await controller.setSigner({ privateKey: secondKey, remember: true, revision })
			await expect(controller.setPaused({ paused: true, revision })).rejects.toThrow('restart is in progress')
		})
	})

	test('latches an indeterminate owner-file save and does not queue a restart', async () => {
		await withController(
			async ({ controller, settings, state, revision, next }) => {
				await expect(controller.setConfigurationDocument({ settings: editableSettings(settings), revision })).rejects.toBeInstanceOf(ConfigurationCommitIndeterminate)
				expect(state.safetyPaused).toBe(true)
				expect(next()).toBeUndefined()
			},
			{
				saveConfiguration: async () => {
					throw new Error('injected sync failure')
				},
			},
		)
	})

	test('the production CLI restarts in process, reacquires locks, and retains a memory-only signer', async () => {
		await withController(async ({ configuration, settings }) => {
			const temporaryServer = Bun.serve({ port: 0, fetch: () => new Response('port allocation') })
			const port = temporaryServer.port
			if (port === undefined) throw new Error('Missing allocated port')
			await temporaryServer.stop(true)
			await saveSettings(configuration.path, { ...settings, runtime: { ...settings.runtime, uiPort: port } }, configuration.revision)
			const child = Bun.spawn(['bun', 'src/cli/run.ts'], { cwd: join(import.meta.dir, '..', '..'), env: { ...process.env, ZOLTAR_CHAOS_CONFIG: configuration.path }, stdout: 'ignore', stderr: 'pipe' })
			const origin = `http://127.0.0.1:${port}`
			async function waitForWallet(wallet: string) {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					try {
						const response = await fetch(`${origin}/api/configuration`)
						const value: unknown = await response.json()
						if (typeof value === 'object' && value !== null && Reflect.get(value, 'wallet') === wallet) return value
					} catch (error) {
						if (!(error instanceof TypeError)) throw error
					}
					await Bun.sleep(25)
				}
				throw new Error('Operator did not reconnect with the expected signer')
			}
			try {
				const before = await waitForWallet(privateKeyToAccount(firstKey).address)
				const replaceSigner = () => fetch(`${origin}/api/signer`, { method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ privateKey: secondKey, remember: false, revision: Reflect.get(before, 'revision') }) })
				let response = await replaceSigner()
				// Startup can briefly reserve the mutation gate even while paused; 423 guarantees no change was applied.
				for (let attempt = 0; response.status === 423 && attempt < 200; attempt += 1) {
					await Bun.sleep(25)
					response = await replaceSigner()
				}
				expect(response.status).toBe(200)
				const after = await waitForWallet(privateKeyToAccount(secondKey).address)
				expect(Reflect.get(after, 'rememberSigner')).toBe(false)
				expect(Reflect.get(after, 'paused')).toBe(true)
				expect(Reflect.get(after, 'execute')).toBe(false)
				const saved = (await loadSettings(configuration.path)).settings
				expect(saved.privateKey).toBeUndefined()
				expect(saved.runtime.stateFile).not.toBe(settings.runtime.stateFile)
				await expect(acquireFileProcessLock(saved.runtime.stateFile, 'competing operator')).rejects.toThrow('already locked')
			} finally {
				child.kill('SIGTERM')
				const code = await child.exited
				const errors = await new Response(child.stderr).text()
				expect(code, errors).toBe(0)
			}
		})
	})
	test('switches custom chain settings and reserves a separate state unit', async () => {
		await withController(async ({ controller, settings, configuration, revision }) => {
			const document = { ...editableSettings(settings), network: { kind: 'custom', chainId: 31337, name: 'Local test', explorerUrl: 'http://localhost', maximumBlockIntervalSeconds: 5 } }
			await controller.setConfigurationDocument({ settings: document, revision })
			const saved = (await loadSettings(configuration.path)).settings
			expect(saved.network.chainId).toBe(31337)
			expect(saved.runtime.stateFile).not.toBe(settings.runtime.stateFile)
			expect((await loadDurableState(saved.runtime.stateFile, 31337)).chainId).toBe(31337)
		})
	})

	test('rejects signer and state-file replacement while a transaction needs recovery', async () => {
		await withController(async ({ controller, settings, state, configuration, revision, next, directory }) => {
			const serializedTransaction = await privateKeyToAccount(firstKey).signTransaction({ chainId: settings.network.chainId, data: '0x', gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 0n, to: '0x0000000000000000000000000000000000000002', value: 0n })
			state.pendingTransactions = [
				{
					data: '0x',
					hash: keccak256(serializedTransaction),
					id: 'intent:test',
					label: 'Test intent',
					maxBlockNumber: 100n,
					mode: 'public',
					nonce: 0n,
					operationId: 'open-oracle.test',
					semanticExpectation: { balanceBaselines: [], evidence: [{ kind: 'receipt-success' }], postconditions: [], storageBaselines: [] },
					sender: privateKeyToAccount(firstKey).address,
					serializedTransaction,
					signedAt: '2026-08-24T00:00:00.000Z',
					status: 'signed',
					stepId: 'step:test',
					to: '0x0000000000000000000000000000000000000002',
					value: 0n,
					workflowId: 'workflow:test',
				},
			]
			await expect(controller.setSigner({ privateKey: secondKey, remember: true, revision })).rejects.toThrow('pending transaction recovery')
			state.workflows = [
				{
					classification: 'selectable',
					createdAtBlock: '1',
					createdAt: '2026-08-24T00:00:00.000Z',
					ecosystem: 'open-oracle',
					id: 'workflow:test',
					label: 'Test workflow',
					metadata: {},
					obligation: false,
					operationId: 'open-oracle.test',
					planId: 'plan:test',
					planningSeed: 1,
					postconditions: [],
					priority: 'random',
					risk: 'low',
					semanticDeadlineBlockNumber: '100',
					status: 'waiting-transaction',
					steps: [
						{
							data: '0x',
							evidence: [{ kind: 'receipt-success' }],
							gasLimit: '21000',
							id: 'step:test',
							label: 'Test step',
							preflightCalls: [],
							status: 'signed',
							to: '0x0000000000000000000000000000000000000002',
							transactionIntentId: 'intent:test',
							transactionHash: keccak256(serializedTransaction),
							value: '0',
							walletAssetDebits: [],
						},
					],
					updatedAt: '2026-08-24T00:00:00.000Z',
				},
			]
			await saveDurableState(settings.runtime.stateFile, state)
			const before = await readdir(directory)
			const document = editableSettings(settings)
			document.runtime.stateFile = join(directory, 'replacement.json')
			await expect(controller.setConfigurationDocument({ settings: document, revision })).rejects.toThrow('pending transaction recovery')
			expect(await readdir(directory)).toEqual(before)
			expect((await loadSettings(configuration.path)).revision).toBe(revision)
			expect((await loadDurableState(settings.runtime.stateFile, settings.network.chainId)).pendingTransactions).toHaveLength(1)
			expect(next()).toBeUndefined()
			expect((await loadSettings(configuration.path)).settings.privateKey).toBe(settings.privateKey)
		})
	})

	test('rejects invalid exposure and private-key edits in the complete editor', async () => {
		await withController(async ({ controller, settings, revision, next }) => {
			const document = editableSettings(settings)
			document.runtime.uiHost = '0.0.0.0'
			await expect(controller.setConfigurationDocument({ settings: document, revision })).rejects.toThrow('host loopback')
			await expect(controller.setConfigurationDocument({ settings: { ...editableSettings(settings), privateKey: secondKey }, revision })).rejects.toThrow('Transaction signer')
			expect(next()).toBeUndefined()
		})
	})

	test('connectivity preflight failures leave the saved configuration intact', async () => {
		await withController(
			async ({ controller, settings, configuration, revision, next }) => {
				const document = { ...editableSettings(settings), networkConfigured: true, connectivity: { readRpcUrl: 'https://read.example', publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], rpcQuorum: 1 } }
				await expect(controller.setConfigurationDocument({ settings: document, revision })).rejects.toThrow('injected preflight failure')
				expect((await loadSettings(configuration.path)).revision).toBe(revision)
				expect(next()).toBeUndefined()
			},
			{
				checkConnectivityUpdate: async () => {
					throw new Error('injected preflight failure')
				},
			},
		)
	})

	test('the complete endpoint exposes editable relay URLs and deployment addresses while excluding the private key', async () => {
		await withController(async ({ controller, configuration, settings }) => {
			const relay = 'https://relay.example/private-token'
			configuration.settings = parseSettings({ ...serializedSettings(settings), submission: { mode: 'private', minimumBundleRelaySuccesses: 1, relayUrls: [relay] } })
			const server = startDashboardServer(0, controller)
			try {
				const response = await fetch(new URL('/api/configuration-document', server.url))
				expect(response.status).toBe(200)
				expect(response.headers.get('cache-control')).toContain('no-store')
				const body = await response.text()
				expect(body).toContain(relay)
				expect(body).toContain(settings.deployment.openOracle)
				expect(body).not.toContain(firstKey)
				expect(body).not.toContain('privateKey')
			} finally {
				await server.stop(true)
			}
		})
	})
})
