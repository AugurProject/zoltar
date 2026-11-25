import { encodeReceiveBasedRedeemRequest, receiveBasedExitArguments } from '../../../../ui/trading/ts/protocol/authorization.js'
import { estimateLiquidity, type LiquidityPreview } from '../../../../ui/trading/ts/features/live/liquidityEstimate.js'
import { encodeReceiveRequest } from '@zoltar/trading-shared/trading/receiveRequest'
import { deployContract } from '../../testSupport/deployContract'
import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, parseAbi, zeroAddress, privateKeyToAccount, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { signTyped } from 'micro-eth-signer'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { compileArtifactsForTests } from './compileArtifactsForTests'
import { PERMIT_TYPES, splitSignature } from '../../testSupport/simulator/utils/typedDataSignatures'
import { flushSolidityBytecodeCoverageForTest, getSolidityBytecodeCoverageProfileHitCountForTest } from '../../testSupport/coverage/traceToSource'
import { ensureDefined } from '../../testSupport/simulator/utils/testUtils'

/** Direct pair calls take a deadline; these tests exercise other properties. */
const NO_DEADLINE = 2n ** 64n

type TradingContracts = Awaited<ReturnType<typeof compileArtifactsForTests>>
const rate = 10n ** 18n
const universe = 17n
const question = 91n
const unboundedShares = 2n ** 256n - 1n

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

	const deploy = async (artifact: Readonly<{ abi: Abi; evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>, args: readonly unknown[] = [], value = 0n) => await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args }), value)

	async function initialize(value = 10_000n, conditionalYesBps = 7_000n) {
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, value, conditionalYesBps, unboundedShares, unboundedShares, 0n, 0n, 1n, account, 10n ** 12n], value }))
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
		if (process.env['TRADING_REPORT_GAS'] === '1') console.log(`gas:${label}=${receipt.gasUsed}`)
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
		pool = await deploy(mocks.TradingMockQuestionLedger, [token, coreFactory, zoltar, questionData, forker, universe, question, rate])
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

	for (const onlyRep of [false, true]) {
		test(`forwards a security pool ${onlyRep ? 'REP-only' : 'ETH and REP'} recovery basket without sweeping prior REP`, async () => {
			await initialize()
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'createCompleteSet', value: 10n }))
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'configureRecovery', args: [7n, onlyRep, true] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockCoreFactory.abi, address: coreFactory, functionName: 'setSecurityPool', args: [pool, pool] }))
			const rep = await client.readContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'repToken' })
			const repAbi = parseAbi(['function mint(address owner,uint256 amount)', 'function balanceOf(address owner) view returns (uint256)'])
			await writeContractAndWait(client, () => client.writeContract({ abi: repAbi, address: rep, functionName: 'mint', args: [router, 11n] }))
			const recipient = `0x${TEST_ADDRESSES[1].toString(16).padStart(40, '0')}` as const
			const beforeEth = await client.getBalance({ address: recipient })
			const ids = [universe << 8n, (universe << 8n) | 1n, (universe << 8n) | 2n]
			const redeem = (minEth: bigint, minRep: bigint) =>
				client.writeContract({
					abi: mocks.TradingMockShareToken.abi,
					address: token,
					functionName: 'safeBatchTransferFrom',
					args: [account, router, ids, [rate, rate, rate], encodeReceiveBasedRedeemRequest({ shareToken: token, pool, pair: onlyRep ? zeroAddress : pair, universeId: universe, questionId: question }, rate, minEth, recipient, 10n ** 12n, minRep)],
				})
			const minEth = onlyRep ? 0n : 1n
			if (onlyRep) await expect(redeem(1n, 0n)).rejects.toThrow('Minimum ETH output')
			const holderBalances = () => Promise.all(([0n, 1n, 2n] as const).map(outcome => tokenBalance(account, outcome)))
			const beforeShares = await holderBalances()
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'configureRecovery', args: [6n, onlyRep, true] }))
			await expect(redeem(minEth, 7n)).rejects.toThrow('Minimum REP output')
			expect(await holderBalances()).toEqual(beforeShares)
			expect(await client.getBalance({ address: recipient })).toBe(beforeEth)
			expect(await client.readContract({ abi: repAbi, address: rep, functionName: 'balanceOf', args: [recipient] })).toBe(0n)
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'configureRecovery', args: [7n, onlyRep, true] }))
			await writeContractAndWait(client, () => redeem(minEth, 7n))
			expect(await client.getBalance({ address: recipient })).toBe(beforeEth + (onlyRep ? 0n : 1n))
			expect(await client.readContract({ abi: repAbi, address: rep, functionName: 'balanceOf', args: [recipient] })).toBe(7n)
			expect(await client.readContract({ abi: repAbi, address: rep, functionName: 'balanceOf', args: [router] })).toBe(11n)
		})
	}

	test('#1445: a sell built by receiveBasedExitArguments enforces the quoted recovery REP minimum', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'createCompleteSet', value: 10n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'configureRecovery', args: [7n, false, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockCoreFactory.abi, address: coreFactory, functionName: 'setSecurityPool', args: [pool, pool] }))
		const rep = await client.readContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'repToken' })
		const repAbi = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
		const recipient = `0x${TEST_ADDRESSES[1].toString(16).padStart(40, '0')}` as const
		const [swapInput] = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'quoteExactOutput', args: [true, rate] })
		const maximumLongShares = rate + swapInput
		const transfer = receiveBasedExitArguments({ shareToken: token, pool, pair, universeId: universe, questionId: question }, 'YES', rate, maximumLongShares, 1n, recipient, 10n ** 12n, 7n)
		const exit = () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, router, transfer.ids, transfer.amounts, transfer.data] })
		const beforeShares = await shareBalances(account)
		// The pool's recovery REP per complete set drops between the quote and the signed submission.
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'configureRecovery', args: [6n, false, true] }))
		await expect(exit()).rejects.toThrow('Minimum REP output')
		expect(await shareBalances(account)).toEqual(beforeShares)
		expect(await client.readContract({ abi: repAbi, address: rep, functionName: 'balanceOf', args: [recipient] })).toBe(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'configureRecovery', args: [7n, false, true] }))
		await writeContractAndWait(client, exit)
		expect(await client.readContract({ abi: repAbi, address: rep, functionName: 'balanceOf', args: [recipient] })).toBe(7n)
	})

	test('direct canonical deployment initializes ERC-20 identity from the inherited constructor', async () => {
		const directPair = await deploy(pairArtifact, [account, pool, 30n, account])
		expect(await client.readContract({ abi: pairArtifact.abi, address: directPair, functionName: 'name' })).toBe('Zoltar Two-Way LP')
		expect(await client.readContract({ abi: pairArtifact.abi, address: directPair, functionName: 'symbol' })).toBe('Z2LP')
		expect(await client.readContract({ abi: pairArtifact.abi, address: directPair, functionName: 'factory' })).toBe(account)
		if (process.env['SOLIDITY_BYTECODE_COVERAGE'] === '1') {
			await flushSolidityBytecodeCoverageForTest()
			expect(await getSolidityBytecodeCoverageProfileHitCountForTest('contracts/ERC20.sol', 45)).toBeGreaterThan(0)
		}
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
		const sink = await client.readContract({ abi: factoryArtifact.abi, address: freshFactory, functionName: 'predeploymentShareSink' })
		for (const outcome of [0n, 1n, 2n] as const) {
			expect(await tokenBalance(cleanPair, outcome)).toBe(0n)
			expect(await tokenBalance(sink, outcome)).toBe(1n)
		}
		expect(await client.readContract({ abi: pairArtifact.abi, address: cleanPair, functionName: 'totalSupply' })).toBe(0n)

		const recipient = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1]).account.address
		const freshRouter = await deploy(routerArtifact, [freshFactory])
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [freshRouter, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: freshRouter, functionName: 'initializeWithEth', args: [cleanPair, 10_000n, 5_000n, unboundedShares, unboundedShares, 0n, 0n, 1n, recipient, 10n ** 12n], value: 10_000n }))
		const [yes, no] = await client.readContract({ abi: pairArtifact.abi, address: cleanPair, functionName: 'getReserves' })
		const scale = yes < no ? yes : no
		expect(await client.readContract({ abi: pairArtifact.abi, address: cleanPair, functionName: 'totalSupply' })).toBe(scale)
		expect(await client.readContract({ abi: pairArtifact.abi, address: cleanPair, functionName: 'balanceOf', args: [recipient] })).toBe(scale - 1000n)
	})

	for (const probability of [2_000n, 8_000n])
		test(`#1440: manipulated first-liquidity fallback cannot pass signed bounds at ${probability} bps`, async () => {
			const value = 100n * 10n ** 18n
			const quote = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, value, probability, unboundedShares, unboundedShares, 0n, 0n, 0n, account, NO_DEADLINE], value })
			const dust = 10n ** 9n
			for (const outcome of [1n, 2n]) await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | outcome, 4n * dust] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'initialize', args: [dust, dust, 0n, account, NO_DEADLINE] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [probability < 5_000n, 3n * dust, 0n, account, NO_DEADLINE] }))
			await expect(
				client.writeContract({
					abi: routerArtifact.abi,
					address: router,
					functionName: 'initializeWithEth',
					args: [pair, value, probability, (quote.result.yesUsed * 10_050n) / 10_000n, (quote.result.noUsed * 10_050n) / 10_000n, (quote.result.yesUsed * 9_950n) / 10_000n, (quote.result.noUsed * 9_950n) / 10_000n, (quote.result.liquidity * 9_950n) / 10_000n, account, NO_DEADLINE],
					value,
				}),
			).rejects.toThrow('Liquidity price slippage')
		})

	test('a dust initialization does not block the atomic first-liquidity path (#1260)', async () => {
		// Anyone can seed the canonical pair with dust at a price of their choosing first.
		for (const outcome of [1n, 2n] as const) await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | outcome, 1_001n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'initialize', args: [1_001n, 1_001n, 0n, account, NO_DEADLINE] }))
		const value = 10_000n
		const shares = value * rate
		// At 70% YES the caller would deposit 3/7 of its YES; the dust pair sits at 50%, outside those bounds.
		const seventyYes = (shares * 3_000n) / 7_000n
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, value, 7_000n, seventyYes, shares, 0n, 0n, 1n, account, 10n ** 12n], value })).rejects.toThrow('Liquidity price slippage')
		// At the caller's own price the atomic path still succeeds and adds liquidity proportionally.
		const lpBefore = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithEth', args: [pool, value, 5_000n, shares, shares, 0n, 0n, shares - 1_000n, account, 10n ** 12n], value }))
		const lpAfter = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		expect(lpAfter - lpBefore).toBe(shares)
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })).toEqual([shares + 1_001n, shares + 1_001n])
		expect(await tokenBalance(router, 1n)).toBe(0n)
		expect(await client.getBalance({ address: router })).toBe(0n)
	})

	test('rejects noncanonical pools and pairs from another trading factory', async () => {
		const noncanonicalPool = await deploy(mocks.TradingMockQuestionLedger, [token, coreFactory, zoltar, questionData, forker, universe, question, rate])
		await expect(client.writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'createPair', args: [noncanonicalPool] })).rejects.toThrow('Noncanonical question ledger')

		const foreignFactory = await deploy(factoryArtifact, [coreFactory, 30n])
		await writeContractAndWait(client, () => client.writeContract({ abi: factoryArtifact.abi, address: foreignFactory, functionName: 'createPair', args: [pool] }))
		const foreignPair = await client.readContract({ abi: factoryArtifact.abi, address: foreignFactory, functionName: 'getPair', args: [pool] })
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [foreignPair, 1n, 1, 1n, account, 10n ** 12n], value: 1n })).rejects.toThrow('Unrecognized pair')
		expect(await tokenBalance(router, 0n)).toBe(0n)
		expect(await client.getBalance({ address: router })).toBe(0n)
	})

	test('keeps parent and child-universe pairs isolated when they share one ShareToken', async () => {
		const childUniverse = universe + 1n
		const childPool = await deploy(mocks.TradingMockQuestionLedger, [token, coreFactory, zoltar, questionData, forker, childUniverse, question, rate])
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
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [childPair, 10_000n, 5_000n, unboundedShares, unboundedShares, 0n, 0n, 1n, account, 10n ** 12n], value: 10_000n }))
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

	for (const mode of ['swapExactInput', 'swapExactOutput', 'removeLiquidity'] as const) {
		test(`#1556 callback reserves match final balances during ${mode}`, async () => {
			await initialize()
			const recipient = await deploy(mocks.TradingReserveReader)
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingReserveReader.abi, address: recipient, functionName: 'configure', args: [pair] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
			if (mode === 'removeLiquidity') {
				await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: mode, args: [rate, 0n, 0n, recipient, NO_DEADLINE] }))
			} else {
				await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: mode, args: [true, rate, mode === 'swapExactInput' ? 1n : 100n * rate, recipient, NO_DEADLINE] }))
			}
			for (const [name, outcome] of [
				['observedYes', 1n],
				['observedNo', 2n],
			] as const)
				expect(await client.readContract({ abi: mocks.TradingReserveReader.abi, address: recipient, functionName: name })).toBe(await tokenBalance(pair, outcome))
			expect(await client.readContract({ abi: mocks.TradingReserveReader.abi, address: recipient, functionName: 'callbacks' })).toBe(1n)
			expect(await tokenBalance(pair, 0n)).toBe(0n)
		})
	}

	test('blocks recipient callback reentrancy without rolling back the intended swap', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		const recipient = await deploy(mocks.TradingReentrantRecipient)
		const payload = encodeFunctionData({ abi: pairArtifact.abi, functionName: 'sync' })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingReentrantRecipient.abi, address: recipient, functionName: 'configure', args: [pair, payload] }))
		const reservesBefore = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, rate, 1n, recipient, NO_DEADLINE] }))
		const reservesAfter = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(await client.readContract({ abi: mocks.TradingReentrantRecipient.abi, address: recipient, functionName: 'reentryBlocked' })).toBe(true)
		expect(reservesAfter[0]).toBeGreaterThan(reservesBefore[0])
		expect(reservesAfter[1]).toBeLessThan(reservesBefore[1])
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('closes swaps and additions while awaiting continuation or inactive, but always permits removal', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'setAwaitingForkContinuation', args: [true] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Fork continuation pending')
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, unboundedShares, unboundedShares, 1n, account, 10n ** 12n], value: 1n })).rejects.toThrow('Fork continuation pending')

		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'setAwaitingForkContinuation', args: [false] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'setSystemState', args: [1] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Pool inactive')
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, unboundedShares, unboundedShares, 1n, account, 10n ** 12n], value: 1n })).rejects.toThrow('Pool inactive')

		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('rejects an ETH liquidity addition sandwiched by a swap toward even odds', async () => {
		const seed = 400n
		await initialize(seed, 2_000n)
		const deposit = 100n
		const slippageBps = 50n
		const quote = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, deposit, unboundedShares, unboundedShares, 0n, account, 10n ** 12n], value: deposit })
		const minimumLiquidity = (quote.result.liquidity * (10_000n - slippageBps)) / 10_000n
		const maximumYes = (quote.result.yesUsed * (10_000n + slippageBps) + 9_999n) / 10_000n
		const maximumNo = (quote.result.noUsed * (10_000n + slippageBps) + 9_999n) / 10_000n
		await expect(client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, deposit, maximumYes, maximumNo, minimumLiquidity, account, 10n ** 12n], value: deposit })).resolves.toBeDefined()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		const frontRunNo = (seed * rate) / 4n
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 2n, frontRunNo] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [false, frontRunNo, 1n, account, NO_DEADLINE] }))
		const [yesReserve, noReserve] = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect((noReserve * 10_000n) / (yesReserve + noReserve)).toBeGreaterThan(4_900n)
		await expect(client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, deposit, maximumYes, maximumNo, minimumLiquidity, account, 10n ** 12n], value: deposit })).rejects.toThrow('Liquidity price slippage')
	})

	// The mock pool mints complete sets at a fixed share rate, so no holding fees accrue between the public read and the
	// transaction. On a QuestionLedger, fees accrued since its last update lower the share rate the router mints at, so the
	// walletless estimate can overstate complete sets, deposits, and LP by those fees; the wallet simulation stays the quote of record.
	test('the walletless liquidity estimate matches router and pair results while no holding fees accrue', async () => {
		const deadline = 10n ** 12n
		const readPoolState = async () => {
			const [yesReserve, noReserve] = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
			return {
				yesReserve,
				noReserve,
				mintFees: { securityMultiplierBps: 12_000n, purchaseFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n, annualFeeBps: 0n, feePrincipalAttoEth: 0n },
				lpTotalSupply: await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'totalSupply' }),
				settlementCollateralAttoEth: await client.readContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'settlementCollateralAttoEth' }),
				shareTokenSupplyAttoShares: await client.readContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'shareTokenSupplyAttoShares' }),
			}
		}
		const expectDepositMatches = (estimate: LiquidityPreview | undefined, result: Readonly<{ completeSetShares: bigint; yesUsed: bigint; noUsed: bigint; yesReturned: bigint; noReturned: bigint; invalidInsurance: bigint; liquidity: bigint }>) => {
			if (estimate === undefined || estimate.operation === 'remove') throw new Error('Expected a deposit estimate')
			expect({ completeSets: estimate.completeSets, yesUsed: estimate.yesUsed, noUsed: estimate.noUsed, yesReturned: estimate.yesReturned, noReturned: estimate.noReturned, invalidReturned: estimate.invalidReturned, liquidity: estimate.liquidity }).toEqual({
				completeSets: result.completeSetShares,
				yesUsed: result.yesUsed,
				noUsed: result.noUsed,
				yesReturned: result.yesReturned,
				noReturned: result.noReturned,
				invalidReturned: result.invalidInsurance,
				liquidity: result.liquidity,
			})
		}

		// Existing complete sets give the pool a share rate; an empty QuestionLedger mints 1:1, which this fixed-rate mock does not model.
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'createCompleteSet', value: 7n }))
		const initialAmount = 10_007n
		const initialYesBps = 3_300n
		const initialQuote = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, initialAmount, initialYesBps, unboundedShares, unboundedShares, 0n, 0n, 0n, account, deadline], value: initialAmount })
		expectDepositMatches(estimateLiquidity(await readPoolState(), 'initialize', initialAmount, initialYesBps), initialQuote.result)
		await initialize(initialAmount, initialYesBps)

		// A swap moves the reserves off the initial ratio so the proportional deposit rounds on both sides.
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		const swapYes = 1_234n * rate + 567n
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, swapYes] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, swapYes, 1n, account, NO_DEADLINE] }))
		for (const deposit of [1n, 333n, 4_001n]) {
			const state = await readPoolState()
			const quote = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, deposit, unboundedShares, unboundedShares, 0n, account, deadline], value: deposit })
			expectDepositMatches(estimateLiquidity(state, 'add', deposit, undefined), quote.result)
			await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, deposit, unboundedShares, unboundedShares, 0n, account, deadline], value: deposit }))
		}

		const lpBalance = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		const state = await readPoolState()
		for (const liquidity of [lpBalance / 3n, lpBalance]) {
			const quote = await client.simulateContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 0n, 0n, account, deadline] })
			expect(estimateLiquidity(state, 'remove', liquidity, undefined)).toEqual({ operation: 'remove', amount: liquidity, yesOut: quote.result[0], noOut: quote.result[1] })
		}
	})

	test('initializes at alternative odds, enters YES, and preserves forced ETH', async () => {
		await initialize()
		const initialReserves = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(initialReserves[1]).toBe(10_000n * rate)
		expect(initialReserves[0]).toBe((10_000n * rate * 3_000n) / 7_000n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
		const invalidBefore = await tokenBalance(account, 0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'setSharesPerEth', args: [2n * rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1_000n, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		expect((await tokenBalance(account, 0n)) - invalidBefore).toBe(2_000n * rate)
		expect(await tokenBalance(pair, 0n)).toBe(0n)

		const force = await deploy(mocks.TradingForceEth, [], 7n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingForceEth.abi, address: force, functionName: 'force', args: [router] }))
		expect(await client.getBalance({ address: router })).toBe(7n)
		expect(await client.getBalance({ address: router })).toBe(7n)
	})

	test('rejects INVALID donations and closes swaps while keeping LP removal open', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, universe << 8n, 1n] }))
		await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, universe << 8n, 1n, '0x'] })).rejects.toThrow('Unsupported share id')
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 1n] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Question ended')
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
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
		const simulation = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1n, 1, 1n, account, 10n ** 12n], value: 1n })
		expect(simulation.result.conditionalYesBpsBefore).toBe((noBalance * 10_000n) / (yesBalance + noBalance))
	})

	test('preserves reserve, product, INVALID, and router-residue invariants across stateful swap sequences', async () => {
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 50_000n, 5_000n, unboundedShares, unboundedShares, 0n, 0n, 1n, account, 10n ** 12n], value: 50_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		for (let index = 0n; index < 16n; index++) {
			const yesForNo = index % 2n === 0n
			const inputId = (universe << 8n) | (yesForNo ? 1n : 2n)
			const amount = (index + 1n) * rate
			const donation = index % 5n === 0n ? 1n : 0n
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, inputId, amount + donation] }))
			if (donation > 0n) await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, inputId, donation, '0x'] }))
			const before = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [yesForNo, amount, 1n, account, NO_DEADLINE] }))
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

	test('reports live reserves immediately after donations', async () => {
		await initialize()
		const donation = 7n * rate
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, donation] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, (universe << 8n) | 1n, donation, '0x'] }))
		const reserves = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(await tokenBalance(pair, 1n)).toBe(reserves[0])
		expect(await tokenBalance(pair, 2n)).toBe(reserves[1])
	})

	test('keeps the pair INVALID balance at zero across liquidity and swap mutations', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1_000n, unboundedShares, unboundedShares, 1n, account, 10n ** 12n], value: 1_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, rate, 1n, account, NO_DEADLINE] }))
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
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1_000n, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		expect(await shareBalances(router)).toEqual(startingBalances)
		expect(await shareBalances(router)).toEqual(startingBalances)
	})

	test('never decreases synchronized effective-reserve product on successful swaps', async () => {
		await initialize(50_000n, 5_000n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		for (const yesForNo of [true, false] as const) {
			const inputOutcome = yesForNo ? 1n : 2n
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | inputOutcome, 20n * rate] }))
			const before = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [yesForNo, 20n * rate, 1n, account, NO_DEADLINE] }))
			const after = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			expect(after[0] * after[1]).toBeGreaterThanOrEqual(before[0] * before[1])
		}
		for (const yesForNo of [true, false] as const) {
			const inputOutcome = yesForNo ? 1n : 2n
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | inputOutcome, 100n * rate] }))
			const before = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [yesForNo, 10n * rate, 100n * rate, account, NO_DEADLINE] }))
			const after = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getEffectiveReserves' })
			expect(after[0] * after[1]).toBeGreaterThanOrEqual(before[0] * before[1])
		}
	})

	test('exact-input swaps enforce the quoted minimum down to one outcome share unit', async () => {
		await initialize(50_000n, 5_000n)
		const input = 10n * rate
		const [output] = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'quoteExactInput', args: [true, input] })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, input] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		const before = await shareBalances(account)
		const swap = (minimum: bigint) => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, input, minimum, account, NO_DEADLINE] })
		await expect(swap(output + 1n)).rejects.toThrow('Swap slippage')
		expect(await shareBalances(account)).toEqual(before)
		await writeContractAndWait(client, () => swap(output))
		expect(await shareBalances(account)).toEqual([before[0], before[1] - input, before[2] + output])
	})

	test('exact-output swaps deliver exactly the request without exceeding max input', async () => {
		await initialize(50_000n, 5_000n)
		const requestedOutput = 10n * rate
		const quote = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'quoteExactOutput', args: [true, requestedOutput] })
		const requiredInput = quote[0]
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, requiredInput + rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, requestedOutput, requiredInput - 1n, account, NO_DEADLINE] })).rejects.toThrow('Swap slippage')
		const inputBefore = await tokenBalance(account, 1n)
		const outputBefore = await tokenBalance(account, 2n)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, requestedOutput, requiredInput, account, NO_DEADLINE] }))
		const inputCharged = inputBefore - (await tokenBalance(account, 1n))
		const outputDelivered = (await tokenBalance(account, 2n)) - outputBefore
		expect(outputDelivered).toBe(requestedOutput)
		expect(inputCharged).toBe(requiredInput)
	})

	test('transferring LP tokens moves the claim without changing supply or reserves', async () => {
		await initialize()
		const recipient = '0x0000000000000000000000000000000000000123'
		const balance = (holder: Address) => client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [holder] })
		const supply = () => client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'totalSupply' })
		const ownerBefore = await balance(account)
		const recipientBefore = await balance(recipient)
		const supplyBefore = await supply()
		const reservesBefore = await shareBalances(pair)
		const amount = ownerBefore / 2n
		expect(amount).toBeGreaterThan(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'transfer', args: [recipient, amount] }))
		expect(await balance(account)).toBe(ownerBefore - amount)
		expect(await balance(recipient)).toBe(recipientBefore + amount)
		expect(await supply()).toBe(supplyBefore)
		expect(await shareBalances(pair)).toEqual(reservesBefore)
	})

	test('prevents LP withdrawals from claiming more shares than the pair owns', async () => {
		await initialize()
		const pairBalancesBefore = await shareBalances(pair)
		const ownedLiquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [ownedLiquidity + 1n, 0n, 0n, account, 10n ** 12n] })).rejects.toThrow('ERC20 transfer amount exceeds sender balance')
		expect(await shareBalances(pair)).toEqual(pairBalancesBefore)
		const recipientBalancesBefore = await shareBalances(account)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [ownedLiquidity, 1n, 1n, account, 10n ** 12n] }))
		const pairBalancesAfter = await shareBalances(pair)
		const recipientBalancesAfter = await shareBalances(account)
		const yesOut = recipientBalancesAfter[1] - recipientBalancesBefore[1]
		const noOut = recipientBalancesAfter[2] - recipientBalancesBefore[2]
		expect(yesOut).toBeLessThanOrEqual(pairBalancesBefore[1])
		expect(noOut).toBeLessThanOrEqual(pairBalancesBefore[2])
		expect(pairBalancesAfter[1] + yesOut).toBe(pairBalancesBefore[1])
		expect(pairBalancesAfter[2] + noOut).toBe(pairBalancesBefore[2])
	})

	test('lets a dust LP position exit when only one side of its share rounds to zero', async () => {
		const yesId = (universe << 8n) | 1n
		const noId = (universe << 8n) | 2n
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, yesId, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, noId, 1_001n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'initialize', args: [1_001n, 1_001n, 1n, account, NO_DEADLINE] }))
		// Move the price until one LP unit is worth less than one NO share.
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 2_000n, 1n, account, NO_DEADLINE] }))
		const [yesReserve, noReserve] = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(noReserve).toBeLessThan(1_001n)
		const yesBefore = await tokenBalance(account, 1n)
		const noBefore = await tokenBalance(account, 2n)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [1n, 0n, 0n, account, 10n ** 12n] }))
		expect((await tokenBalance(account, 1n)) - yesBefore).toBe(yesReserve / 1_001n)
		expect((await tokenBalance(account, 2n)) - noBefore).toBe(0n)
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		// The permanently locked minimum liquidity keeps both reserves positive.
		const locked = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(locked[0]).toBeGreaterThan(0n)
		expect(locked[1]).toBeGreaterThan(0n)
		const lock = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'MINIMUM_LIQUIDITY_LOCK' })
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [lock] })).toBe(1000n)
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'totalSupply' })).toBe(1000n)
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'initialize', args: [2_000n, 3_000n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Already initialized')
	})

	test('direct pair calls reject an expired deadline', async () => {
		await initialize()
		const expired = (await client.getBlock()).timestamp - 1n
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 1n, 10n * rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, (universe << 8n) | 2n, 10n * rate] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, rate, 1n, account, expired] })).rejects.toThrow('Deadline expired')
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, rate, 10n * rate, account, expired] })).rejects.toThrow('Deadline expired')
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'addLiquidity', args: [rate, rate, 1n, account, expired] })).rejects.toThrow('Deadline expired')
		// The same swap succeeds while its deadline is still ahead.
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, rate, 1n, account, NO_DEADLINE] }))
	})

	test('#1495: status and transaction guards agree when an ended question is also inactive', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'setSystemState', args: [1] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(1n)
		await expect(client.simulateContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Question ended')
	})

	test('does not resume trading after lifecycle closure', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 1n] }))
		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Question ended')
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [true, 1n, 10n, account, NO_DEADLINE] })).rejects.toThrow('Question ended')
		}
	})

	test('keeps liquidity removal available after lifecycle closure', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockForker.abi, address: forker, functionName: 'setQuestionOutcome', args: [pool, 2] }))
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
	})

	for (const [outcomeName, outcome] of [
		['NO', 2],
		['INVALID', 0],
	] as const) {
		test(`closes swaps after ${outcomeName} resolution while preserving raw LP removal`, async () => {
			await initialize()
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockForker.abi, address: forker, functionName: 'setQuestionOutcome', args: [pool, outcome] }))
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account, NO_DEADLINE] })).rejects.toThrow('Question resolved')
			const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
			expect(await tokenBalance(pair, 0n)).toBe(0n)
		})
	}

	test('benchmarks every hot operation against a funded pool fixture', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await measuredTransaction('exact-input-swap', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 100n * rate, 1n, account, NO_DEADLINE] }))
		await measuredTransaction('exact-output-swap', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [false, 10n * rate, 100n * rate, account, NO_DEADLINE] }))
		await measuredTransaction('eth-entry', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1_000n, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		await measuredTransaction('add-liquidity', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1_000n, unboundedShares, unboundedShares, 1n, account, 10n ** 12n], value: 1_000n }))
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		const liquidityToRemove = liquidity / 10n
		await measuredTransaction('remove-liquidity', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidityToRemove, 1n, 1n, account, 10n ** 12n] }))
	})

	test('redeems directly transferred complete sets without operator approval and enforces LP deadlines', async () => {
		const contracts = await compileArtifactsForTests()
		const factoryArtifact = contracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
		const pairArtifact = contracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
		const routerArtifact = contracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
		const currentFactory = await deploy(factoryArtifact, [coreFactory, 30n])
		const currentRouter = await deploy(routerArtifact, [currentFactory])
		await writeContractAndWait(client, () => client.writeContract({ abi: factoryArtifact.abi, address: currentFactory, functionName: 'createPair', args: [pool] }))
		const currentPair = await client.readContract({ abi: factoryArtifact.abi, address: currentFactory, functionName: 'getPair', args: [pool] })
		expect(await client.readContract({ abi: factoryArtifact.abi, address: currentFactory, functionName: 'predictPair', args: [pool] })).toBe(currentPair)
		expect(await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'DOMAIN_SEPARATOR' })).not.toBe(`0x${'00'.repeat(32)}`)
		await expect(client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'permit', args: [account, currentRouter, 7n, 0n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`] })).rejects.toThrow('ERC2612 permit expired')

		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionLedger.abi, address: pool, functionName: 'createCompleteSet', value: 20_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [currentPair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'initialize', args: [10_000n * rate, 10_000n * rate, 1n, account, NO_DEADLINE] }))
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'balanceOf', args: [account] })
		await expect(client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 0n] })).rejects.toThrow('Deadline expired')
		const permitDeadline = 10n ** 12n
		const ethereum = getAnvilWindowEthereum()
		const chainId = await client.getChainId()
		const recipient = `0x${TEST_ADDRESSES[1].toString(16).padStart(40, '0')}` as Address
		const permitOwnerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
		const wrongSignerKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412d99615a5f2f5f0'
		const permitOwner = privateKeyToAccount(permitOwnerKey)
		await ethereum.impersonateAccount(permitOwner.address)
		await ethereum.setBalance(permitOwner.address, 10n ** 20n)
		const permitOwnerClient = createWriteClient(ethereum, BigInt(permitOwner.address))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'transfer', args: [permitOwner.address, liquidity / 2n] }))
		const signPermit = async ({ signedChainId = chainId, name = 'Zoltar Two-Way LP', nonce, owner = permitOwner.address, signerKey = permitOwnerKey, spender = currentRouter, value }: { signedChainId?: number; name?: string; nonce?: bigint; owner?: Address; signerKey?: Hex; spender?: Address; value: bigint }) => {
			const signedNonce = nonce ?? (await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'nonces', args: [permitOwner.address] }))
			const signature = signTyped(
				{
					domain: { chainId: signedChainId, name, version: '1', verifyingContract: currentPair },
					primaryType: 'Permit',
					types: {
						EIP712Domain: [
							{ name: 'name', type: 'string' },
							{ name: 'version', type: 'string' },
							{ name: 'chainId', type: 'uint256' },
							{ name: 'verifyingContract', type: 'address' },
						],
						...PERMIT_TYPES,
					},
					message: { owner, spender, value, nonce: signedNonce, deadline: permitDeadline },
				},
				signerKey,
			)
			return splitSignature(signature)
		}

		const permittedLiquidity = liquidity / 4n
		const permit = await signPermit({ value: permittedLiquidity })
		await writeContractAndWait(permitOwnerClient, () => permitOwnerClient.writeContract({ abi: routerArtifact.abi, address: currentRouter, functionName: 'removeLiquidityWithPermit', args: [currentPair, permittedLiquidity, 1n, 1n, permitOwner.address, permitDeadline, permit.v, permit.r, permit.s] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'allowance', args: [permitOwner.address, currentRouter] })).toBe(0n)
		await expect(permitOwnerClient.writeContract({ abi: routerArtifact.abi, address: currentRouter, functionName: 'removeLiquidityWithPermit', args: [currentPair, permittedLiquidity, 1n, 1n, permitOwner.address, permitDeadline, permit.v, permit.r, permit.s] })).rejects.toThrow('LP permit or allowance')
		// An expired deadline fails the same way without a standing allowance: the permit is refused before the pair checks its own deadline.
		const expiredDeadline = (await client.getBlock()).timestamp - 1n
		await expect(permitOwnerClient.writeContract({ abi: routerArtifact.abi, address: currentRouter, functionName: 'removeLiquidityWithPermit', args: [currentPair, permittedLiquidity, 1n, 1n, permitOwner.address, expiredDeadline, permit.v, permit.r, permit.s] })).rejects.toThrow('LP permit or allowance')

		const preSubmittedLiquidity = liquidity / 8n
		const preSubmittedPermit = await signPermit({ value: preSubmittedLiquidity })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'permit', args: [permitOwner.address, currentRouter, preSubmittedLiquidity, permitDeadline, preSubmittedPermit.v, preSubmittedPermit.r, preSubmittedPermit.s] }))
		await writeContractAndWait(permitOwnerClient, () =>
			permitOwnerClient.writeContract({ abi: routerArtifact.abi, address: currentRouter, functionName: 'removeLiquidityWithPermit', args: [currentPair, preSubmittedLiquidity, 1n, 1n, permitOwner.address, permitDeadline, preSubmittedPermit.v, preSubmittedPermit.r, preSubmittedPermit.s] }),
		)

		const wrongPermitCases = [
			await signPermit({ value: 7n, spender: account }),
			await signPermit({ value: 8n }),
			await signPermit({ value: 7n, nonce: 99n }),
			await signPermit({ value: 7n, signedChainId: chainId + 1 }),
			await signPermit({ value: 7n, name: 'Wrong LP' }),
			await signPermit({ value: 7n, owner: recipient }),
			await signPermit({ value: 7n, signerKey: wrongSignerKey }),
		]
		for (const invalidPermit of wrongPermitCases) {
			await expect(client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'permit', args: [permitOwner.address, currentRouter, 7n, permitDeadline, invalidPermit.v, invalidPermit.r, invalidPermit.s] })).rejects.toThrow('ERC2612 invalid signer')
		}

		const redeemAmount = rate
		const recipientEthBefore = await client.getBalance({ address: recipient })
		const ids = [universe << 8n, (universe << 8n) | 1n, (universe << 8n) | 2n] as const
		const deadline = 10n ** 12n
		const redeemRequest = ({
			version = 3,
			operation = 1,
			questionLedger = pool,
			configuredPair = currentPair,
			longOutcome = 3,
			completeSetShares = redeemAmount,
			maxLongSharesIn = 0n,
			minEthOut = 1n,
			payoutRecipient = recipient,
			refundRecipient = account,
			requestDeadline = deadline,
		}: Partial<{
			version: number
			operation: number
			questionLedger: Address
			configuredPair: Address
			longOutcome: number
			completeSetShares: bigint
			maxLongSharesIn: bigint
			minEthOut: bigint
			payoutRecipient: Address
			refundRecipient: Address
			requestDeadline: bigint
		}> = {}) => encodeReceiveRequest([version, operation, questionLedger, configuredPair, longOutcome, completeSetShares, maxLongSharesIn, minEthOut, payoutRecipient, refundRecipient, requestDeadline, 0n])
		const requestData = encodeReceiveBasedRedeemRequest({ shareToken: token, pool, pair: currentPair, universeId: universe, questionId: question }, redeemAmount, 1n, recipient, deadline)
		const sharesBeforeRedeem = await shareBalances(account)
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'isApprovedForAll', args: [account, currentRouter] })).toBe(false)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], requestData] }))
		expect((await client.getBalance({ address: recipient })) - recipientEthBefore).toBe(1n)
		for (const outcome of [0n, 1n, 2n] as const) expect(await tokenBalance(account, outcome)).toBe(ensureDefined(sharesBeforeRedeem[Number(outcome)], 'missing share balance before redeem') - redeemAmount)
		expect(await shareBalances(currentRouter)).toEqual([0n, 0n, 0n])
		expect(await client.getBalance({ address: currentRouter })).toBe(0n)

		const routerResidue: [bigint, bigint, bigint] = [7n, 11n, 13n]
		for (const [outcome, amount] of routerResidue.entries())
			await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'forceMintWithoutCallback', args: [currentRouter, ensureDefined(ids[outcome], 'missing share token id for router residue'), amount] }))
		const forcedEth = await deploy(mocks.TradingForceEth, [], 7n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingForceEth.abi, address: forcedEth, functionName: 'force', args: [currentRouter] }))
		expect(await shareBalances(currentRouter)).toEqual(routerResidue)
		expect(await client.getBalance({ address: currentRouter })).toBe(7n)

		const exitAmount = rate
		const [swapInput] = await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'quoteExactOutput', args: [true, exitAmount] })
		const maximumLongShares = exitAmount + swapInput + 17n
		const yesBeforeExit = await tokenBalance(account, 1n)
		const exitRecipientEthBefore = await client.getBalance({ address: recipient })
		const exitData = encodeReceiveRequest([3, 0, pool, currentPair, 1, exitAmount, maximumLongShares, 1n, recipient, account, deadline, 0n])
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, [ids[0], ids[1]], [exitAmount, maximumLongShares], exitData] }))
		expect(yesBeforeExit - (await tokenBalance(account, 1n))).toBe(exitAmount + swapInput)
		expect((await client.getBalance({ address: recipient })) - exitRecipientEthBefore).toBe(1n)
		expect(await shareBalances(currentRouter)).toEqual(routerResidue)
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'isApprovedForAll', args: [currentRouter, currentPair] })).toBe(false)

		const malformedRequests = [
			{ name: 'version', data: redeemRequest({ version: 1 }) },
			{ name: 'operation', data: redeemRequest({ operation: 2 }) },
			{ name: 'question ledger', data: redeemRequest({ questionLedger: account }) },
			{ name: 'pair', data: redeemRequest({ configuredPair: account }) },
			...([0, 1, 2] as const).map(longOutcome => ({ name: `long outcome ${longOutcome}`, data: redeemRequest({ longOutcome }) })),
			{ name: 'maximum input', data: redeemRequest({ maxLongSharesIn: 1n }) },
			{ name: 'zero payout', data: redeemRequest({ payoutRecipient: `0x${'00'.repeat(20)}` }) },
			{ name: 'router payout', data: redeemRequest({ payoutRecipient: currentRouter }) },
			{ name: 'zero refund', data: redeemRequest({ refundRecipient: `0x${'00'.repeat(20)}` }) },
			{ name: 'router refund', data: redeemRequest({ refundRecipient: currentRouter }) },
			{ name: 'deadline', data: redeemRequest({ requestDeadline: 0n }) },
			{ name: 'slippage', data: redeemRequest({ minEthOut: 2n }) },
		] as const
		const redemptionBalances = async () => ({
			owner: await shareBalances(account),
			router: await shareBalances(currentRouter),
			pair: await shareBalances(currentPair),
			poolEth: await client.getBalance({ address: pool }),
			routerEth: await client.getBalance({ address: currentRouter }),
			recipientEth: await client.getBalance({ address: recipient }),
		})
		const balancesBeforeRejections = await redemptionBalances()
		for (const malformed of malformedRequests) {
			await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], malformed.data] }), malformed.name).rejects.toThrow(
				malformed.name.startsWith('long outcome') ? 'Unexpected redeem fields' : undefined,
			)
			expect(await redemptionBalances(), malformed.name).toEqual(balancesBeforeRejections)
		}
		for (const malformedTransfer of [
			{ ids: [ids[1], ids[0], ids[2]], values: [redeemAmount, redeemAmount, redeemAmount] },
			{ ids: [ids[0], ids[1]], values: [redeemAmount, redeemAmount] },
			{ ids: [ids[0], ids[1], ids[1]], values: [redeemAmount, redeemAmount, redeemAmount] },
			{ ids: [ids[0], ids[1], ids[2], ids[2]], values: [redeemAmount, redeemAmount, redeemAmount, redeemAmount] },
			{ ids, values: [redeemAmount, redeemAmount, redeemAmount + 1n] },
		] as const) {
			await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, malformedTransfer.ids, malformedTransfer.values, requestData] })).rejects.toThrow()
		}
		await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], '0x'] })).rejects.toThrow()
		expect(await shareBalances(currentRouter)).toEqual(routerResidue)

		const safe = await deploy(mocks.TradingMockSafe)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [safe, true] }))
		await expect(client.writeContract({ abi: mocks.TradingMockSafe.abi, address: safe, functionName: 'transferBatch', args: [token, account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], requestData] })).rejects.toThrow('Transfer must be owner initiated')
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSafe.abi, address: safe, functionName: 'createCompleteSet', args: [pool], value: 1n }))
		const safeRedeemData = redeemRequest({ payoutRecipient: safe, refundRecipient: safe })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSafe.abi, address: safe, functionName: 'transferBatch', args: [token, safe, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], safeRedeemData] }))
		expect(await client.getBalance({ address: safe })).toBe(1n)

		const safeLiquidity = liquidity / 16n
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'transfer', args: [safe, safeLiquidity] }))
		const safeApprove = encodeFunctionData({ abi: pairArtifact.abi, functionName: 'approve', args: [currentRouter, safeLiquidity] })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSafe.abi, address: safe, functionName: 'execute', args: [currentPair, safeApprove] }))
		const safeRemoval = encodeFunctionData({ abi: routerArtifact.abi, functionName: 'removeLiquidityWithPermit', args: [currentPair, safeLiquidity, 1n, 1n, safe, deadline, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`] })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSafe.abi, address: safe, functionName: 'execute', args: [currentRouter, safeRemoval] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'balanceOf', args: [safe] })).toBe(0n)

		const reentrantRecipient = await deploy(mocks.TradingReentrantRecipient)
		const reentryPayload = encodeFunctionData({ abi: routerArtifact.abi, functionName: 'onERC1155BatchReceived', args: [reentrantRecipient, reentrantRecipient, [], [], '0x'] })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingReentrantRecipient.abi, address: reentrantRecipient, functionName: 'configure', args: [currentRouter, reentryPayload] }))
		const reentrantRedeemData = redeemRequest({ payoutRecipient: reentrantRecipient })
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], reentrantRedeemData] }))
		expect(await client.readContract({ abi: mocks.TradingReentrantRecipient.abi, address: reentrantRecipient, functionName: 'reentryBlocked' })).toBe(true)
		expect(await shareBalances(currentRouter)).toEqual(routerResidue)

		const directLiquidity = liquidity / 32n
		expect(await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'allowance', args: [account, currentRouter] })).toBe(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'removeLiquidity', args: [directLiquidity, 1n, 1n, account, deadline] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'allowance', args: [account, currentRouter] })).toBe(0n)
		await expect(client.writeContract({ abi: routerArtifact.abi, address: currentRouter, functionName: 'removeLiquidityWithPermit', args: [pair, 1n, 1n, 1n, account, deadline, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`] })).rejects.toThrow('Unrecognized pair')
		expect(await client.getBalance({ address: currentRouter })).toBe(7n)
	})
})
