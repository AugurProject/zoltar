import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Abi, type Address, type Hex } from '@zoltar/shared/ethereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { compileArtifactsForTests } from './compileArtifactsForTests'

type TradingContracts = Awaited<ReturnType<typeof compileArtifactsForTests>>
const rate = 10n ** 18n
const universe = 17n
const question = 91n

describe('factory, pair, and router integration', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let account: Address
	let token: Address
	let zoltar: Address
	let questionData: Address
	let forker: Address
	let coreFactory: Address
	let pool: Address
	let factory: Address
	let router: Address
	let pair: Address
	let mocks: TradingContracts['contracts/trading/test/TradingProtocolMocks.sol']
	let factoryArtifact: TradingContracts['contracts/trading/TwoWayConstantProductFactory.sol']['TwoWayConstantProductFactory']
	let pairArtifact: TradingContracts['contracts/trading/TwoWayConstantProductPair.sol']['TwoWayConstantProductPair']
	let routerArtifact: TradingContracts['contracts/trading/TwoWayConstantProductRouter.sol']['TwoWayConstantProductRouter']

	async function deploy<TAbi extends Abi>(artifact: Readonly<{ abi: TAbi; evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>, args: readonly unknown[] = [], value = 0n) {
		const hash = await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` as Hex, args }), value })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.status === 'reverted' || receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Contract deployment failed')
		return receipt.contractAddress
	}

	async function initialize(value = 10_000n, conditionalYesBps = 7_000n) {
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, conditionalYesBps, 1n, account, 10n ** 12n], value }))
	}

	async function tokenBalance(owner: Address, outcome: 0n | 1n | 2n) {
		const tokenId = (universe << 8n) | outcome
		return await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'balanceOf', args: [owner, tokenId] })
	}

	async function shareBalances(owner: Address) {
		return await Promise.all([tokenBalance(owner, 0n), tokenBalance(owner, 1n), tokenBalance(owner, 2n)])
	}

	async function measuredTransaction(label: string, execute: () => Promise<Hex>) {
		const hash = await writeContractAndWait(client, execute)
		const receipt = await client.getTransactionReceipt({ hash })
		if (process.env.TRADING_REPORT_GAS === '1') console.log(`gas:${label}=${receipt.gasUsed}`)
		return receipt.gasUsed
	}

	beforeAll(async () => {
		const contracts = await compileArtifactsForTests()
		mocks = contracts['contracts/trading/test/TradingProtocolMocks.sol']
		factoryArtifact = contracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
		pairArtifact = contracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
		routerArtifact = contracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
		const ethereum = getAnvilWindowEthereum()
		account = `0x${TEST_ADDRESSES[0].toString(16).padStart(40, '0')}`
		await ethereum.impersonateAccount(account)
		await ethereum.setBalance(account, 10n ** 24n)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		zoltar = await deploy(mocks.TradingMockZoltar)
		questionData = await deploy(mocks.TradingMockQuestionData)
		forker = await deploy(mocks.TradingMockForker)
		token = await deploy(mocks.TradingMockShareToken)
		coreFactory = await deploy(mocks.TradingMockCoreFactory)
		pool = await deploy(mocks.TradingMockSecurityPool, [token, coreFactory, zoltar, questionData, forker, universe, question, rate])
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockForker.abi, address: forker, functionName: 'setQuestionOutcome', args: [pool, 3] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setCanonicalPool', args: [universe, pool] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockCoreFactory.abi, address: coreFactory, functionName: 'setPool', args: [pool, universe] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 10n ** 12n] }))
		factory = await deploy(factoryArtifact, [coreFactory, 30n])
		router = await deploy(routerArtifact, [factory])
		await writeContractAndWait(client, () => client.writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'createPair', args: [pool] }))
		pair = await client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [pool] })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [router, true] }))
		await setBaselineSnapshot()
	})

	test('validates canonical identity and deterministic pair address', async () => {
		const predicted = await client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'predictPair', args: [pool] })
		expect(predicted).toBe(pair)
		expect(await client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'isPair', args: [pair] })).toBe(true)
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'invalidTokenId' })).toBe(universe << 8n)
	})

	test('quarantines canonical shares sent to the counterfactual pair address before deployment', async () => {
		const freshFactory = await deploy(factoryArtifact, [coreFactory, 30n])
		const predicted = await client.readContract({ abi: factoryArtifact.abi, address: freshFactory, functionName: 'predictPair', args: [pool] })
		const tokenIds = [universe << 8n, (universe << 8n) | 1n, (universe << 8n) | 2n] as const
		for (const tokenId of tokenIds) {
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, tokenId, 1n] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, predicted, tokenId, 1n, '0x'] }))
		}

		await writeContractAndWait(client, () => client.writeContract({ abi: factoryArtifact.abi, address: freshFactory, functionName: 'createPair', args: [pool] }))
		const cleanPair = await client.readContract({ abi: factoryArtifact.abi, address: freshFactory, functionName: 'getPair', args: [pool] })
		expect(cleanPair).toBe(predicted)
		for (const outcome of [0n, 1n, 2n] as const) expect(await tokenBalance(cleanPair, outcome)).toBe(0n)

		const freshRouter = await deploy(routerArtifact, [freshFactory])
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [freshRouter, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: freshRouter, functionName: 'initializeWithEth', args: [cleanPair, 5_000n, 1n, account, 10n ** 12n], value: 10_000n }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: cleanPair, functionName: 'totalSupply' })).toBeGreaterThan(0n)
	})

	test('rejects noncanonical pools and pairs from another trading factory', async () => {
		const noncanonicalPool = await deploy(mocks.TradingMockSecurityPool, [token, coreFactory, zoltar, questionData, forker, universe, question, rate])
		await expect(client.writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'createPair', args: [noncanonicalPool] })).rejects.toThrow('Noncanonical security pool')

		const foreignFactory = await deploy(factoryArtifact, [coreFactory, 30n])
		await writeContractAndWait(client, () => client.writeContract({ abi: factoryArtifact.abi, address: foreignFactory, functionName: 'createPair', args: [pool] }))
		const foreignPair = await client.readContract({ abi: factoryArtifact.abi, address: foreignFactory, functionName: 'getPair', args: [pool] })
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [foreignPair, 1, 1n, account, 10n ** 12n], value: 1n })).rejects.toThrow('Unrecognized pair')
		expect(await tokenBalance(router, 0n)).toBe(0n)
		expect(await client.getBalance({ address: router })).toBe(0n)
	})

	test('keeps parent and child-universe pairs isolated when they share one ShareToken', async () => {
		const childUniverse = universe + 1n
		const childPool = await deploy(mocks.TradingMockSecurityPool, [token, coreFactory, zoltar, questionData, forker, childUniverse, question, rate])
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockForker.abi, address: forker, functionName: 'setQuestionOutcome', args: [childPool, 3] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setCanonicalPool', args: [childUniverse, childPool] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockCoreFactory.abi, address: coreFactory, functionName: 'setPool', args: [childPool, childUniverse] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 10n ** 12n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'createPair', args: [childPool] }))
		const childPair = await client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [childPool] })
		expect(childPair).not.toBe(pair)
		expect(await client.readContract({ abi: pairArtifact.abi, address: childPair, functionName: 'yesTokenId' })).toBe((childUniverse << 8n) | 1n)

		await initialize()
		const parentReserves = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [childPair, 5_000n, 1n, account, 10n ** 12n], value: 10_000n }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })).toEqual(parentReserves)
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'balanceOf', args: [childPair, childUniverse << 8n] })).toBe(0n)
	})

	test('rejects unsolicited router callbacks and ordinary ETH transfers', async () => {
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'onERC1155Received', args: [account, account, (universe << 8n) | 1n, 1n, '0x'] })).rejects.toThrow('Unexpected share callback')
		await expect(client.call({ account: client.account, to: router, value: 1n })).rejects.toThrow('Unexpected ETH')
		expect(await tokenBalance(router, 1n)).toBe(0n)
		expect(await client.getBalance({ address: router })).toBe(0n)
	})

	test('rejects foreign share contracts and token IDs from another universe', async () => {
		await initialize()
		const foreignToken = await deploy(mocks.TradingMockShareToken)
		const yesId = (universe << 8n) | 1n
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: foreignToken, functionName: 'mint', args: [account, yesId, 1n] }))
		await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: foreignToken, functionName: 'safeTransferFrom', args: [account, pair, yesId, 1n, '0x'] })).rejects.toThrow('Wrong share token')

		const foreignUniverseId = ((universe + 1n) << 8n) | 1n
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, foreignUniverseId, 1n] }))
		await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, foreignUniverseId, 1n, '0x'] })).rejects.toThrow('Unsupported share id')
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: foreignToken, functionName: 'balanceOf', args: [pair, yesId] })).toBe(0n)
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'balanceOf', args: [pair, foreignUniverseId] })).toBe(0n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('blocks recipient callback reentrancy without rolling back the intended swap', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		const recipient = await deploy(mocks.TradingReentrantRecipient)
		const payload = encodeFunctionData({ abi: pairArtifact.abi, functionName: 'sync' })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingReentrantRecipient.abi, address: recipient, functionName: 'configure', args: [pair, payload] }))
		const reservesBefore = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, rate, 1n, recipient] }))
		const reservesAfter = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(await client.readContract({ abi: mocks.TradingReentrantRecipient.abi, address: recipient, functionName: 'reentryBlocked' })).toBe(true)
		expect(reservesAfter[0]).toBeGreaterThan(reservesBefore[0])
		expect(reservesAfter[1]).toBeLessThan(reservesBefore[1])
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('closes swaps and additions while awaiting continuation or inactive, but always permits removal', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSecurityPool.abi, address: pool, functionName: 'setAwaitingForkContinuation', args: [true] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Fork continuation pending')
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, account, 10n ** 12n], value: 1n })).rejects.toThrow('Fork continuation pending')

		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSecurityPool.abi, address: pool, functionName: 'setAwaitingForkContinuation', args: [false] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSecurityPool.abi, address: pool, functionName: 'setSystemState', args: [1] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Pool inactive')
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, account, 10n ** 12n], value: 1n })).rejects.toThrow('Pool inactive')

		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'approve', args: [router, liquidity] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'removeLiquidity', args: [pair, liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('initializes at alternative odds, enters YES, exits an insured amount, and preserves forced ETH', async () => {
		await initialize()
		const initialReserves = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(initialReserves[1]).toBe(10_000n * rate)
		expect(initialReserves[0]).toBe((10_000n * rate * 3_000n) / 7_000n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
		const invalidBefore = await tokenBalance(account, 0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSecurityPool.abi, address: pool, functionName: 'setSharesPerEth', args: [2n * rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		expect((await tokenBalance(account, 0n)) - invalidBefore).toBe(2_000n * rate)
		expect(await tokenBalance(pair, 0n)).toBe(0n)

		const force = await deploy(mocks.TradingForceEth, [], 7n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingForceEth.abi, address: force, functionName: 'force', args: [router] }))
		expect(await client.getBalance({ address: router })).toBe(7n)
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'exitPosition', args: [pair, 1, 100n * rate, 1_000n * rate, 50n, account, 10n ** 12n] }))
		expect(await client.getBalance({ address: router })).toBe(7n)
		expect(await tokenBalance(router, 0n)).toBe(0n)
		expect(await tokenBalance(router, 1n)).toBe(0n)
		expect(await tokenBalance(router, 2n)).toBe(0n)
	})

	test('rejects INVALID donations and closes swaps while keeping LP removal open', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, universe << 8n, 1n] }))
		await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, universe << 8n, 1n, '0x'] })).rejects.toThrow('Unsupported share id')
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 1n] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'approve', args: [router, liquidity] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'removeLiquidity', args: [pair, liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('reports a donation-adjusted pre-trade conditional price', async () => {
		await initialize()
		const donation = 1_000n * rate
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, donation] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, (universe << 8n) | 1n, donation, '0x'] }))
		const yesBalance = await tokenBalance(pair, 1n)
		const noBalance = await tokenBalance(pair, 2n)
		const simulation = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, 10n ** 12n], value: 1n })
		expect(simulation.result.conditionalYesBpsBefore).toBe((noBalance * 10_000n) / (yesBalance + noBalance))
	})

	test('preserves reserve, product, INVALID, and router-residue invariants across a stateful swap sequence', async () => {
		await initialize(50_000n, 5_000n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		for (let index = 0n; index < 16n; index++) {
			const yesForNo = index % 2n === 0n
			const inputId = (universe << 8n) | (yesForNo ? 1n : 2n)
			const amount = (index + 1n) * rate
			const donation = index % 5n === 0n ? 1n : 0n
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, inputId, amount + donation] }))
			if (donation > 0n) await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, inputId, donation, '0x'] }))
			const before = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [yesForNo, amount, 1n, account] }))
			const after = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
			expect(after[0] * after[1]).toBeGreaterThanOrEqual(before[0] * before[1])
			expect(await tokenBalance(pair, 1n)).toBe(after[0])
			expect(await tokenBalance(pair, 2n)).toBe(after[1])
			expect(await tokenBalance(pair, 0n)).toBe(0n)
			expect(await tokenBalance(router, 0n)).toBe(0n)
			expect(await tokenBalance(router, 1n)).toBe(0n)
			expect(await tokenBalance(router, 2n)).toBe(0n)
		}
	})

	test('keeps pair YES and NO balances at or above their stored reserves', async () => {
		await initialize()
		const donation = 7n * rate
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, donation] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, (universe << 8n) | 1n, donation, '0x'] }))
		const reserves = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(await tokenBalance(pair, 1n)).toBeGreaterThanOrEqual(reserves[0])
		expect(await tokenBalance(pair, 2n)).toBeGreaterThanOrEqual(reserves[1])
	})

	test('keeps the pair INVALID balance at zero across liquidity and swap mutations', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, account, 10n ** 12n], value: 1_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, rate, 1n, account] }))
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('restores all router share balances while preserving pre-existing residue', async () => {
		const startingBalances: [bigint, bigint, bigint] = [7n, 11n, 13n]
		for (const [outcome, amount] of startingBalances.entries()) {
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'forceMintWithoutCallback', args: [router, (universe << 8n) | BigInt(outcome), amount] }))
		}
		expect(await shareBalances(router)).toEqual(startingBalances)
		await initialize()
		expect(await shareBalances(router)).toEqual(startingBalances)
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		expect(await shareBalances(router)).toEqual(startingBalances)
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'exitPosition', args: [pair, 1, 100n * rate, 1_000n * rate, 1n, account, 10n ** 12n] }))
		expect(await shareBalances(router)).toEqual(startingBalances)
	})

	test('never decreases synchronized effective-reserve product on successful swaps', async () => {
		await initialize(50_000n, 5_000n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		for (const yesForNo of [true, false] as const) {
			const inputOutcome = yesForNo ? 1n : 2n
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | inputOutcome, 20n * rate] }))
			const before = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [yesForNo, 20n * rate, 1n, account] }))
			const after = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			expect(after[0] * after[1]).toBeGreaterThanOrEqual(before[0] * before[1])
		}
		for (const yesForNo of [true, false] as const) {
			const inputOutcome = yesForNo ? 1n : 2n
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | inputOutcome, 100n * rate] }))
			const before = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [yesForNo, 10n * rate, 100n * rate, account] }))
			const after = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			expect(after[0] * after[1]).toBeGreaterThanOrEqual(before[0] * before[1])
		}
	})

	test('exact-output swaps deliver exactly the request without exceeding max input', async () => {
		await initialize(50_000n, 5_000n)
		const requestedOutput = 10n * rate
		const quote = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'quoteExactOutput', args: [true, requestedOutput] })
		const requiredInput = quote[0]
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, requiredInput + rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, requestedOutput, requiredInput - 1n, account] })).rejects.toThrow('Swap slippage')
		const inputBefore = await tokenBalance(account, 1n)
		const outputBefore = await tokenBalance(account, 2n)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, requestedOutput, requiredInput, account] }))
		const inputCharged = inputBefore - (await tokenBalance(account, 1n))
		const outputDelivered = (await tokenBalance(account, 2n)) - outputBefore
		expect(outputDelivered).toBe(requestedOutput)
		expect(inputCharged).toBe(requiredInput)
	})

	test('prevents LP withdrawals from claiming more shares than the pair owns', async () => {
		await initialize()
		const pairBalancesBefore = await shareBalances(pair)
		const ownedLiquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [ownedLiquidity + 1n, 0n, 0n, account] })).rejects.toThrow('LP balance')
		expect(await shareBalances(pair)).toEqual(pairBalancesBefore)
		const recipientBalancesBefore = await shareBalances(account)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [ownedLiquidity, 1n, 1n, account] }))
		const pairBalancesAfter = await shareBalances(pair)
		const recipientBalancesAfter = await shareBalances(account)
		const yesOut = recipientBalancesAfter[1] - recipientBalancesBefore[1]
		const noOut = recipientBalancesAfter[2] - recipientBalancesBefore[2]
		expect(yesOut).toBeLessThanOrEqual(pairBalancesBefore[1])
		expect(noOut).toBeLessThanOrEqual(pairBalancesBefore[2])
		expect(pairBalancesAfter[1] + yesOut).toBe(pairBalancesBefore[1])
		expect(pairBalancesAfter[2] + noOut).toBe(pairBalancesBefore[2])
	})

	test('does not resume trading after lifecycle closure', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 1n] }))
		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, 1n, 10n, account] })).rejects.toThrow('Question ended')
		}
	})

	test('keeps liquidity removal available after lifecycle closure', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockForker.abi, address: forker, functionName: 'setQuestionOutcome', args: [pool, 2] }))
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
	})

	for (const [outcomeName, outcome] of [
		['NO', 2],
		['INVALID', 0],
	] as const) {
		test(`closes swaps after ${outcomeName} resolution while preserving raw LP removal`, async () => {
			await initialize()
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockForker.abi, address: forker, functionName: 'setQuestionOutcome', args: [pool, outcome] }))
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question resolved')
			const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
			expect(await tokenBalance(pair, 0n)).toBe(0n)
		})
	}

	test('benchmarks every hot operation against a funded pool fixture', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await measuredTransaction('exact-input-swap', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 100n * rate, 1n, account] }))
		await measuredTransaction('exact-output-swap', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [false, 10n * rate, 100n * rate, account] }))
		await measuredTransaction('eth-entry', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		await measuredTransaction('insured-exit', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'exitPosition', args: [pair, 1, 100n * rate, 1_000n * rate, 1n, account, 10n ** 12n] }))
		await measuredTransaction('add-liquidity', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, account, 10n ** 12n], value: 1_000n }))
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		const liquidityToRemove = liquidity / 10n
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'approve', args: [router, liquidityToRemove] }))
		await measuredTransaction('remove-liquidity', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'removeLiquidity', args: [pair, liquidityToRemove, 1n, 1n, account, 10n ** 12n] }))
	})
})
