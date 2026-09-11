import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, encodeFunctionData, isHex, privateKeyToAccount, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { signTyped } from 'micro-eth-signer'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { compileArtifactsForTests } from './compileArtifactsForTests'
import { flushSolidityBytecodeCoverageForTest, getSolidityBytecodeCoverageProfileHitCountForTest } from '../../testSupport/coverage/traceToSource'

type TradingContracts = Awaited<ReturnType<typeof compileArtifactsForTests>>
const rate = 10n ** 18n
const universe = 17n
const question = 91n

function splitSignature(signature: string) {
	if (!isHex(signature) || signature.length !== 132) throw new Error('Expected a 65-byte signature')
	return {
		r: `0x${signature.slice(2, 66)}` as Hex,
		s: `0x${signature.slice(66, 130)}` as Hex,
		v: Number.parseInt(signature.slice(130, 132), 16),
	}
}

const receiveRequestParameter = {
	type: 'tuple',
	components: [
		{ name: 'version', type: 'uint8' },
		{ name: 'operation', type: 'uint8' },
		{ name: 'shareToken', type: 'address' },
		{ name: 'securityPool', type: 'address' },
		{ name: 'pair', type: 'address' },
		{ name: 'universeId', type: 'uint248' },
		{ name: 'questionId', type: 'uint256' },
		{ name: 'invalidTokenId', type: 'uint256' },
		{ name: 'yesTokenId', type: 'uint256' },
		{ name: 'noTokenId', type: 'uint256' },
		{ name: 'longOutcome', type: 'uint8' },
		{ name: 'completeSetShares', type: 'uint256' },
		{ name: 'maxLongSharesIn', type: 'uint256' },
		{ name: 'minEthOut', type: 'uint256' },
		{ name: 'payoutRecipient', type: 'address' },
		{ name: 'refundRecipient', type: 'address' },
		{ name: 'deadline', type: 'uint256' },
	],
} as const

type ReceiveRequest = readonly [number, number, Address, Address, Address, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint, Address, Address, bigint]

function encodeReceiveRequest(request: ReceiveRequest) {
	return encodeAbiParameters([receiveRequestParameter], [request])
}

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
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await tokenBalance(pair, 0n)).toBe(0n)
	})

	test('initializes at alternative odds, enters YES, and preserves forced ETH', async () => {
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
		expect(await client.getBalance({ address: router })).toBe(7n)
	})

	test('rejects INVALID donations and closes swaps while keeping LP removal open', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'mint', args: [account, universe << 8n, 1n] }))
		await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeTransferFrom', args: [account, pair, universe << 8n, 1n, '0x'] })).rejects.toThrow('Unsupported share id')
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockQuestionData.abi, address: questionData, functionName: 'setEndTime', args: [question, 1n] }))
		await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
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
		const simulation = await client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, 10n ** 12n], value: 1n })
		expect(simulation.result.conditionalYesBpsBefore).toBe((noBalance * 10_000n) / (yesBalance + noBalance))
	})

	test('preserves reserve, product, INVALID, and router-residue invariants across stateful swap sequences', async () => {
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, 10n ** 12n], value: 50_000n }))
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
			await expect(client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question resolved')
			const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
			await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
			expect(await tokenBalance(pair, 0n)).toBe(0n)
		})
	}

	test('benchmarks every hot operation against a funded pool fixture', async () => {
		await initialize()
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [pair, true] }))
		await measuredTransaction('exact-input-swap', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 100n * rate, 1n, account] }))
		await measuredTransaction('exact-output-swap', () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactOutput', args: [false, 10n * rate, 100n * rate, account] }))
		await measuredTransaction('eth-entry', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, 10n ** 12n], value: 1_000n }))
		await measuredTransaction('add-liquidity', () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, 1n, account, 10n ** 12n], value: 1_000n }))
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

		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockSecurityPool.abi, address: pool, functionName: 'createCompleteSet', value: 20_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'setApprovalForAll', args: [currentPair, true] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'initialize', args: [10_000n * rate, 10_000n * rate, 1n, account] }))
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
		const permitOwnerClient = createWriteClient(ethereum, BigInt(permitOwner.address), 0)
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
						Permit: [
							{ name: 'owner', type: 'address' },
							{ name: 'spender', type: 'address' },
							{ name: 'value', type: 'uint256' },
							{ name: 'nonce', type: 'uint256' },
							{ name: 'deadline', type: 'uint256' },
						],
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
			version = 1,
			operation = 1,
			shareToken = token,
			securityPool = pool,
			configuredPair = currentPair,
			universeId = universe,
			questionId = question,
			invalidTokenId = ids[0],
			yesTokenId = ids[1],
			noTokenId = ids[2],
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
			shareToken: Address
			securityPool: Address
			configuredPair: Address
			universeId: bigint
			questionId: bigint
			invalidTokenId: bigint
			yesTokenId: bigint
			noTokenId: bigint
			longOutcome: number
			completeSetShares: bigint
			maxLongSharesIn: bigint
			minEthOut: bigint
			payoutRecipient: Address
			refundRecipient: Address
			requestDeadline: bigint
		}> = {}) => encodeReceiveRequest([version, operation, shareToken, securityPool, configuredPair, universeId, questionId, invalidTokenId, yesTokenId, noTokenId, longOutcome, completeSetShares, maxLongSharesIn, minEthOut, payoutRecipient, refundRecipient, requestDeadline])
		const requestData = redeemRequest()
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'isApprovedForAll', args: [account, currentRouter] })).toBe(false)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], requestData] }))
		expect((await client.getBalance({ address: recipient })) - recipientEthBefore).toBe(1n)

		const routerResidue: [bigint, bigint, bigint] = [7n, 11n, 13n]
		for (const [outcome, amount] of routerResidue.entries()) await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'forceMintWithoutCallback', args: [currentRouter, ids[outcome], amount] }))
		const forcedEth = await deploy(mocks.TradingForceEth, [], 7n)
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingForceEth.abi, address: forcedEth, functionName: 'force', args: [currentRouter] }))
		expect(await shareBalances(currentRouter)).toEqual(routerResidue)
		expect(await client.getBalance({ address: currentRouter })).toBe(7n)

		const exitAmount = rate
		const [swapInput] = await client.readContract({ abi: pairArtifact.abi, address: currentPair, functionName: 'quoteExactOutput', args: [true, exitAmount] })
		const maximumLongShares = exitAmount + swapInput + 17n
		const yesBeforeExit = await tokenBalance(account, 1n)
		const exitRecipientEthBefore = await client.getBalance({ address: recipient })
		const exitData = encodeReceiveRequest([1, 0, token, pool, currentPair, universe, question, ids[0], ids[1], ids[2], 1, exitAmount, maximumLongShares, 1n, recipient, account, deadline])
		await writeContractAndWait(client, () => client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, [ids[0], ids[1]], [exitAmount, maximumLongShares], exitData] }))
		expect(yesBeforeExit - (await tokenBalance(account, 1n))).toBe(exitAmount + swapInput)
		expect((await client.getBalance({ address: recipient })) - exitRecipientEthBefore).toBe(1n)
		expect(await shareBalances(currentRouter)).toEqual(routerResidue)
		expect(await client.readContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'isApprovedForAll', args: [currentRouter, currentPair] })).toBe(false)

		const malformedRequests = [
			{ name: 'version', data: redeemRequest({ version: 2 }) },
			{ name: 'operation', data: redeemRequest({ operation: 2 }) },
			{ name: 'share token', data: redeemRequest({ shareToken: account }) },
			{ name: 'security pool', data: redeemRequest({ securityPool: account }) },
			{ name: 'pair', data: redeemRequest({ configuredPair: account }) },
			{ name: 'universe', data: redeemRequest({ universeId: universe + 1n }) },
			{ name: 'question', data: redeemRequest({ questionId: question + 1n }) },
			{ name: 'INVALID ID', data: redeemRequest({ invalidTokenId: ids[0] + 3n }) },
			{ name: 'YES ID', data: redeemRequest({ yesTokenId: ids[2] }) },
			{ name: 'NO ID', data: redeemRequest({ noTokenId: ids[1] }) },
			{ name: 'long outcome', data: redeemRequest({ longOutcome: 1 }) },
			{ name: 'maximum input', data: redeemRequest({ maxLongSharesIn: 1n }) },
			{ name: 'zero payout', data: redeemRequest({ payoutRecipient: `0x${'00'.repeat(20)}` }) },
			{ name: 'router payout', data: redeemRequest({ payoutRecipient: currentRouter }) },
			{ name: 'zero refund', data: redeemRequest({ refundRecipient: `0x${'00'.repeat(20)}` }) },
			{ name: 'router refund', data: redeemRequest({ refundRecipient: currentRouter }) },
			{ name: 'deadline', data: redeemRequest({ requestDeadline: 0n }) },
			{ name: 'slippage', data: redeemRequest({ minEthOut: 2n }) },
		] as const
		for (const malformed of malformedRequests) {
			await expect(client.writeContract({ abi: mocks.TradingMockShareToken.abi, address: token, functionName: 'safeBatchTransferFrom', args: [account, currentRouter, ids, [redeemAmount, redeemAmount, redeemAmount], malformed.data] }), malformed.name).rejects.toThrow()
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
