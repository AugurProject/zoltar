import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, getAddress, parseTransaction, privateKeyToAccount, zeroAddress } from '../support/bot-shared.ts'
import type { OperatorSettings } from '../../src/config/settings.ts'
import { recoverPendingTransactions } from '../../src/execution/recovery.ts'
import { CHAOS_FINALITY_BLOCKS, TransactionAwaitingRecovery, executeOperationPlan, type ExecutionEnvironment } from '../../src/execution/transaction-executor.ts'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'
import { chaosChain, createChaosReadPool, performCanonicalScan } from '../../src/runtime/canonical-scan.ts'
import { executionProfileId } from '../../src/runtime/operator.ts'
import { initialDurableState, initialRuntimeState, loadRuntimeState } from '../../src/state/operator-state.ts'
import { ZoltarQuestionData_ZoltarQuestionData, statoblast_SecurityPool_SecurityPool, statoblast_WETH9_WETH9, trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory } from '../../../../solidity/ts/types/contractArtifact.ts'
import { CHAOS_TEST_PRIVATE_KEY, ONE_TOKEN, WETH_ADDRESS, createChaosAnvilFixture, type ChaosAnvilFixture, type ChaosRpcProxy } from './anvil-fixture.ts'

const SCAN_SEED = 42
const ANVIL_CLOCK = () => 2_000_000_700_000
const OPERATION_IDS = ['zoltar.question.create-binary', 'open-oracle.weth.wrap', 'trading.pair.create', 'statoblast.vault.deposit-rep'] as const

let fixture: ChaosAnvilFixture | undefined

beforeAll(async () => {
	fixture = await createChaosAnvilFixture()
})

afterAll(async () => {
	await fixture?.dispose()
})

function requiredFixture() {
	if (fixture === undefined) throw new Error('Anvil integration fixture was not initialized')
	return fixture
}

async function temporaryStateFile() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-integration-'))
	return {
		dispose: async () => await rm(directory, { force: true, recursive: true }),
		path: join(directory, 'operator-state.json'),
	}
}

function settingsFor(current: ChaosAnvilFixture, proxy: ChaosRpcProxy, stateFile: string): OperatorSettings {
	return {
		connectivity: {
			publicRpcUrls: [proxy.rpcUrl],
			quorumRpcUrls: [],
			readRpcUrl: proxy.rpcUrl,
			rpcQuorum: 1,
		},
		deployment: {
			openOracle: current.infra.openOracle,
			questionData: current.infra.zoltarQuestionData,
			securityPoolFactory: current.infra.securityPoolFactory,
			securityPoolForker: current.infra.securityPoolForker,
			tradingFactory: current.tradingFactory,
			tradingRouter: current.tradingRouter,
			weth: getAddress(WETH_ADDRESS),
			zoltar: current.infra.zoltar,
		},
		discovery: {
			maxPools: 100,
			maxQuestions: 100,
			maxStagedOperationsPerPool: 100,
			maxUniverses: 100,
			maxVaultsPerPool: 100,
		},
		network: { chainId: 1, explorerUrl: '', maximumBlockIntervalSeconds: 15, name: 'mainnet' },
		networkConfigured: true,
		paused: false,
		privateKey: CHAOS_TEST_PRIVATE_KEY,
		runtime: {
			execute: true,
			lifecyclePollMilliseconds: 1_000,
			once: false,
			protocolLogBlockSpan: 50_000,
			protocolStartBlock: 0n,
			stateFile,
			ui: false,
			uiHost: '127.0.0.1',
			uiPort: 4_193,
		},
		scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
		strategy: {
			allowHighRiskOperations: true,
			allowIrreversibleOperations: false,
			enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
			maximumEthPerOperationAttoEth: ONE_TOKEN,
			maximumGasCostAttoEth: ONE_TOKEN,
			maximumRepPerOperationAttoRep: 200n * ONE_TOKEN,
			minimumEthReserveAttoEth: ONE_TOKEN,
			minimumRepReserveAttoRep: 100n * ONE_TOKEN,
			workflowValidForBlocks: 256n,
		},
		submission: {
			minimumBundleRelaySuccesses: 1,
			mode: 'public',
			relayUrls: [],
		},
		version: 1,
	}
}

function requiredPlan(evaluations: readonly EvaluatedOperation[], id: string): OperationPlan {
	const matching = evaluations.filter(evaluation => evaluation.definition.id === id)
	expect(matching, `${id} evaluation`).toHaveLength(1)
	const evaluation = matching[0]
	if (evaluation === undefined) throw new Error(`Canonical scan did not include ${id}`)
	expect(evaluation.eligibility, `${id} eligibility`).toEqual({ blockers: [], eligible: true })
	if (evaluation.plan === undefined) throw new Error(`Canonical scan did not produce an executable ${id} plan: ${evaluation.eligibility.blockers.join('; ')}`)
	return evaluation.plan
}

function runtimeContext(settings: OperatorSettings) {
	const account = privateKeyToAccount(CHAOS_TEST_PRIVATE_KEY)
	const pool = createChaosReadPool(settings)
	const state = initialRuntimeState(false, account.address, settings.network.chainId, initialDurableState(settings.network.chainId, false, executionProfileId(settings), account.address))
	const chain = chaosChain(settings)
	const wallet = createWalletClient({ account, chain, transport: pool.transport })
	const environment: ExecutionEnvironment = {
		chain,
		clock: ANVIL_CLOCK,
		finalityBlocks: CHAOS_FINALITY_BLOCKS,
		pool,
		sender: account.address,
		settings,
		state,
		wallet,
	}
	return { account, chain, environment, pool, state }
}

async function canonicalPlans(context: ReturnType<typeof runtimeContext>) {
	const scan = await performCanonicalScan(context.environment.settings, context.pool, context.account.address, SCAN_SEED, undefined, undefined, false, undefined, { clock: ANVIL_CLOCK })
	expect(scan.indexComplete).toBeTrue()
	expect(scan.carryProofJournalComplete).toBeTrue()
	context.state.evaluations = scan.evaluations
	context.state.inventory = scan.inventory
	context.state.lastScannedBlock = scan.anchor.blockNumber
	context.state.protocolIndex = scan.index
	return { plans: OPERATION_IDS.map(id => requiredPlan(scan.evaluations, id)), scan }
}

async function canonicalRescan(context: ReturnType<typeof runtimeContext>, previous?: Awaited<ReturnType<typeof performCanonicalScan>>) {
	const scan = await performCanonicalScan(context.environment.settings, context.pool, context.account.address, SCAN_SEED, previous?.index, previous?.carryProofJournal, false, previous?.topologyCache, { clock: ANVIL_CLOCK })
	expect(scan.indexComplete).toBeTrue()
	expect(scan.carryProofJournalComplete).toBeTrue()
	context.state.evaluations = scan.evaluations
	context.state.inventory = scan.inventory
	context.state.lastScannedBlock = scan.anchor.blockNumber
	context.state.protocolIndex = scan.index
	return scan
}

async function executeCanonicalOperation(context: ReturnType<typeof runtimeContext>, scan: Awaited<ReturnType<typeof performCanonicalScan>>, id: string) {
	const plan = requiredPlan(scan.evaluations, id)
	const workflow = await executeOperationPlan(context.environment, plan)
	expect(workflow.status, `${id} workflow status`).toBe('completed')
	expect(
		workflow.steps.every(step => step.status === 'confirmed'),
		`${id} transaction status`,
	).toBeTrue()
	return { plan, scan: await canonicalRescan(context, scan), workflow }
}

describe('real ecosystem workflows through the production chaos runtime', () => {
	test('scans and executes Zoltar, OpenOracle, Trading, and Statoblast plans as EIP-1559 transactions', async () => {
		const current = requiredFixture()
		await current.restoreBaseline()
		const proxy = current.createRpcProxy()
		const stateFile = await temporaryStateFile()
		try {
			const settings = settingsFor(current, proxy, stateFile.path)
			const context = runtimeContext(settings)
			const { plans } = await canonicalPlans(context)
			const readClient = createPublicClient({ chain: context.chain, transport: context.pool.transport })
			const wethBefore = await readClient.readContract({ abi: statoblast_WETH9_WETH9.abi, address: getAddress(WETH_ADDRESS), args: [context.account.address], functionName: 'balanceOf' })

			const completed = []
			for (const plan of plans) completed.push(await executeOperationPlan(context.environment, plan))

			const completedSteps = completed.flatMap(workflow => workflow.steps)
			expect(completedSteps).toHaveLength(5)
			expect(completedSteps.every(step => step.status === 'confirmed')).toBeTrue()
			expect(completed.every(workflow => workflow.status === 'completed')).toBeTrue()
			expect(context.state.pendingTransactions).toEqual([])
			expect(proxy.successfulSendRawTransactionParams).toHaveLength(5)
			expect(proxy.rawTransactions).toHaveLength(5)
			for (const rawTransaction of proxy.rawTransactions) {
				expect(rawTransaction.startsWith('0x02')).toBeTrue()
				expect(parseTransaction(rawTransaction).type).toBe('eip1559')
			}

			const [questionCount, wethAfter, pair, vault] = await Promise.all([
				readClient.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: current.infra.zoltarQuestionData, functionName: 'getQuestionCount' }),
				readClient.readContract({ abi: statoblast_WETH9_WETH9.abi, address: getAddress(WETH_ADDRESS), args: [context.account.address], functionName: 'balanceOf' }),
				readClient.readContract({ abi: trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.abi, address: current.tradingFactory, args: [current.pool], functionName: 'getPair' }),
				readClient.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: current.pool, args: [context.account.address], functionName: 'securityVaults' }),
			])
			expect(questionCount).toBe(current.baselineQuestionCount + 1n)
			expect(wethAfter).toBeGreaterThan(wethBefore)
			expect(pair).not.toBe(zeroAddress)
			expect(vault[0]).toBeGreaterThan(0n)
		} finally {
			proxy.dispose()
			await stateFile.dispose()
		}
	})

	test('recovers a mined Statoblast deposit after a lost submission acknowledgement without replaying it', async () => {
		const current = requiredFixture()
		await current.restoreBaseline()
		const proxy = current.createRpcProxy({ lostAcknowledgementOrdinal: 2 })
		const stateFile = await temporaryStateFile()
		try {
			const settings = settingsFor(current, proxy, stateFile.path)
			const context = runtimeContext(settings)
			const { scan } = await canonicalPlans(context)
			const plan = requiredPlan(scan.evaluations, 'statoblast.vault.deposit-rep')
			expect(plan.steps.map(step => step.id)).toEqual(['approve-rep', 'deposit-rep'])

			await expect(executeOperationPlan(context.environment, plan)).rejects.toBeInstanceOf(TransactionAwaitingRecovery)
			expect(proxy.rawTransactions).toHaveLength(2)
			expect(context.state.pendingTransactions).toHaveLength(1)

			const reloaded = await loadRuntimeState(stateFile.path, false, context.account.address, settings.network.chainId)
			const recoveryEnvironment: ExecutionEnvironment = { ...context.environment, state: reloaded }
			await expect(recoverPendingTransactions(recoveryEnvironment, { resubmit: true })).resolves.toBeTrue()

			expect(proxy.rawTransactions).toHaveLength(2)
			expect(proxy.successfulSendRawTransactionParams).toHaveLength(2)
			expect(reloaded.pendingTransactions).toEqual([])
			expect(reloaded.workflows).toHaveLength(1)
			const workflow = reloaded.workflows[0]
			if (workflow === undefined) throw new Error('Recovered workflow was not persisted')
			expect(workflow.steps.map(step => step.status)).toEqual(['confirmed', 'confirmed'])
			expect(workflow.status).toBe('completed')
		} finally {
			proxy.dispose()
			await stateFile.dispose()
		}
	})

	test('rescans between dependent Zoltar, OpenOracle, Statoblast, and Trading state transitions', async () => {
		const current = requiredFixture()
		await current.restoreBaseline()
		const proxy = current.createRpcProxy()
		const relay = current.createPrivateRelay()
		const stateFile = await temporaryStateFile()
		try {
			const settings = settingsFor(current, proxy, stateFile.path)
			settings.submission = { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [relay.relayUrl] }
			const context = runtimeContext(settings)
			let scan = await canonicalRescan(context)
			const execute = async (id: string) => {
				const result = await executeCanonicalOperation(context, scan, id)
				scan = result.scan
				return result
			}

			await execute('zoltar.question.create-categorical')
			expect(scan.snapshot.questions).toHaveLength(Number(current.baselineQuestionCount) + 1)

			await execute('open-oracle.weth.wrap')
			const deposit = await execute('open-oracle.deposit')
			const creditToken = deposit.plan.metadata['token']
			if (typeof creditToken !== 'string') throw new Error('OpenOracle deposit did not identify its credited token')
			const depositedCredit = scan.snapshot.wallet.tokens.find(token => token.address.toLowerCase() === creditToken.toLowerCase())?.openOracleCredit
			expect(BigInt(depositedCredit ?? '0')).toBeGreaterThan(1n)

			await execute('open-oracle.withdraw')
			const withdrawnCredit = scan.snapshot.wallet.tokens.find(token => token.address.toLowerCase() === creditToken.toLowerCase())?.openOracleCredit
			expect(withdrawnCredit).toBe('1')

			await execute('statoblast.vault.deposit-rep')
			const depositedVault = scan.snapshot.pools.find(pool => pool.address.toLowerCase() === current.pool.toLowerCase())?.vaults.find(vault => vault.address.toLowerCase() === context.account.address.toLowerCase())
			if (depositedVault === undefined) throw new Error('Statoblast deposit did not create a discoverable wallet vault')
			expect(BigInt(depositedVault.repBackingAttoRep)).toBeGreaterThan(0n)
			await execute('statoblast.complete-set.create')
			const mintedShares = scan.snapshot.wallet.shares.find(shares => shares.universeId === '0')
			expect(BigInt(mintedShares?.invalid ?? '0')).toBeGreaterThan(0n)
			expect(BigInt(mintedShares?.yes ?? '0')).toBeGreaterThan(0n)
			expect(BigInt(mintedShares?.no ?? '0')).toBeGreaterThan(0n)

			await execute('statoblast.complete-set.redeem')
			const redeemedShares = scan.snapshot.wallet.shares.find(shares => shares.universeId === '0')
			expect(redeemedShares).toMatchObject({ invalid: '0', no: '0', yes: '0' })

			await execute('trading.pair.create')
			const uninitializedPair = scan.snapshot.pairs.find(pair => pair.pool.toLowerCase() === current.pool.toLowerCase())
			expect(uninitializedPair?.status).toBe(6)

			await execute('trading.pair.initialize-eth')
			const initializedPair = scan.snapshot.pairs.find(pair => pair.pool.toLowerCase() === current.pool.toLowerCase())
			expect(initializedPair?.status).toBe(0)
			expect(BigInt(initializedPair?.totalSupply ?? '0')).toBeGreaterThan(0n)
			expect(BigInt(initializedPair?.walletLiquidity ?? '0')).toBeGreaterThan(0n)

			const liquidityBeforeAdd = BigInt(initializedPair?.walletLiquidity ?? '0')
			await execute('trading.liquidity.add-eth')
			const pairAfterAdd = scan.snapshot.pairs.find(pair => pair.pool.toLowerCase() === current.pool.toLowerCase())
			expect(BigInt(pairAfterAdd?.walletLiquidity ?? '0')).toBeGreaterThan(liquidityBeforeAdd)

			expect(context.state.pendingTransactions).toEqual([])
			expect(proxy.rawTransactions).toEqual([])
			expect(relay.rawTransactions).toHaveLength(12)
			expect(relay.rawTransactions.every(rawTransaction => parseTransaction(rawTransaction).type === 'eip1559')).toBeTrue()
		} finally {
			relay.dispose()
			proxy.dispose()
			await stateFile.dispose()
		}
	})
})
