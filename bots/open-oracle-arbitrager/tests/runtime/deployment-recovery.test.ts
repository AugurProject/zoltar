import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfiguration } from '#config/configuration'
import { networkConfiguration } from '#config/network'
import { parseOperatorSettings, saveOperatorSettings } from '#config/settings-store'
import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { executorArtifact } from '#contracts/artifacts.generated'
import type { OperatorState } from '#state/operator-state'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import example from '../../config/operator.example.json'
import { createDeploymentRecoveryReconciliation } from '../../src/runtime/deployment-recovery.ts'

const temporaryDirectories: string[] = []
const quorumEnvironment = process.env['ZOLTAR_BOT_RPC_QUORUM']

afterEach(async () => {
	if (quorumEnvironment === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
	else process.env['ZOLTAR_BOT_RPC_QUORUM'] = quorumEnvironment
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/** A read endpoint that answers `eth_getCode` from a fixed table, or is unreachable when the table is undefined. */
function readEndpoint(codes: Record<string, string> | undefined) {
	return createPublicClient({
		chain: networkConfiguration('sepolia').chain,
		transport: custom({
			request: async ({ method, params }) => {
				if (codes === undefined) throw new Error('fetch failed: connection refused')
				if (method !== 'eth_getCode' || !Array.isArray(params) || typeof params[0] !== 'string') throw new Error(`Unexpected request ${method}`)
				return codes[params[0].toLowerCase()] ?? '0x'
			},
		}),
	})
}

test('reconciles a journal only when the configured read quorum agrees the executor bytecode is present', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-recovery-quorum-'))
	temporaryDirectories.push(directory)
	const settingsFile = join(directory, 'operator.json')
	await saveOperatorSettings(
		settingsFile,
		parseOperatorSettings({
			...example,
			connectivity: { publicRpcUrls: ['https://public.example/'], readRpcUrl: 'https://read.example/' },
			deployment: { ...example.deployment, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] },
			network: 'sepolia',
			networkConfigured: true,
			rpcQuorum: 2,
			runtime: { ...example.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') },
		}),
	)
	const config = await loadConfiguration(settingsFile)
	expect(config.rpcQuorum).toBe(2)
	const executor = canonicalExecutorIdentity().address.toLowerCase()
	const executorPresent = { [executor]: `0x${executorArtifact.evm.deployedBytecode.object}` }
	const state: Pick<OperatorState, 'operationLog'> = { operationLog: [] }
	const reconcile = (clients: ReturnType<typeof readEndpoint>[]) => createDeploymentRecoveryReconciliation({ config, readClients: () => clients, state }).verifyExecutorDeployed()
	// One endpoint sees the executor (and would report WETH missing to the checklist) while the other two are unreachable: not a quorum.
	await expect(reconcile([readEndpoint(executorPresent), readEndpoint(undefined), readEndpoint(undefined)])).rejects.toThrow('Executor deployment verification requires at least two independent RPC endpoints')
	// Two reachable endpoints that disagree about the code are also not a quorum; the recovery stays pending without an error.
	expect(await reconcile([readEndpoint(executorPresent), readEndpoint({}), readEndpoint(undefined)])).toBe(false)
	expect(await reconcile([readEndpoint(executorPresent), readEndpoint({}), readEndpoint({})])).toBe(false)
	// Two independent endpoints seeing the code settle it even while a lagging third still reports it absent.
	expect(await reconcile([readEndpoint(executorPresent), readEndpoint({}), readEndpoint(executorPresent)])).toBe(true)
	expect(await reconcile([readEndpoint(undefined), readEndpoint(executorPresent), readEndpoint(executorPresent)])).toBe(true)
	// An endpoint failing in a way the safety policy does not recognise as an outage still stops the scan, as everywhere else.
	const suspicious = createPublicClient({
		chain: networkConfiguration('sepolia').chain,
		transport: custom({
			request: async () => {
				throw new Error('unexpected response shape')
			},
		}),
	})
	await expect(reconcile([readEndpoint(executorPresent), readEndpoint(executorPresent), suspicious])).rejects.toThrow('unexpected response shape')
})

test('does not probe placeholder endpoints for a reconciled journal while the chain is unconfigured', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-recovery-'))
	temporaryDirectories.push(directory)
	const settingsFile = join(directory, 'operator.json')
	await saveOperatorSettings(settingsFile, parseOperatorSettings({ ...example, connectivity: undefined, networkConfigured: false, runtime: { ...example.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') } }))
	const config = await loadConfiguration(settingsFile)
	expect(config.networkConfigured).toBe(false)
	const state: Pick<OperatorState, 'canonicalDeployments' | 'operationLog'> = { canonicalDeployments: undefined, operationLog: [] }
	const reconciliation = createDeploymentRecoveryReconciliation({
		config,
		readClients: () => {
			throw new Error('An unconfigured operator must not read the chain')
		},
		state,
	})
	expect(await reconciliation.verifyExecutorDeployed()).toBe(false)
	expect(state.canonicalDeployments).toBeUndefined()
	// Configuring the chain is read at call time, so the same reconciliation starts verifying once the operator is configured.
	config.networkConfigured = true
	await expect(reconciliation.verifyExecutorDeployed()).rejects.toThrow('An unconfigured operator must not read the chain')
	reconciliation.onReconciled(`0x${'44'.repeat(32)}`)
	expect(state.operationLog.map(entry => [entry.level, entry.message, entry.details])).toEqual([['info', 'Executor deployment recovery reconciled externally', `0x${'44'.repeat(32)}`]])
})
