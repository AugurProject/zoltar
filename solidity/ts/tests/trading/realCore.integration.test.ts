import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, type Abi, type Address, type Hex } from '@zoltar/shared/evm/ethereum'
import { useStatoblastVaultAccountingFixture } from '../statoblast/fixture'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { compileArtifactsForTests } from './compileArtifactsForTests'

type TradingContracts = Awaited<ReturnType<typeof compileArtifactsForTests>>
const attoEthToAttoSharesAbi = [{ type: 'function', name: 'attoEthToAttoShares', stateMutability: 'view', inputs: [{ name: 'amountAttoEth', type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi
const attoSharesToAttoEthAbi = [{ type: 'function', name: 'attoSharesToAttoEth', stateMutability: 'view', inputs: [{ name: 'amountAttoShares', type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi
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

describe('trading against authoritative Zoltar contracts', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	let account: Address
	let factory: Address
	let router: Address
	let pair: Address
	let factoryArtifact: TradingContracts['contracts/trading/TwoWayConstantProductFactory.sol']['TwoWayConstantProductFactory']
	let pairArtifact: TradingContracts['contracts/trading/TwoWayConstantProductPair.sol']['TwoWayConstantProductPair']
	let routerArtifact: TradingContracts['contracts/trading/TwoWayConstantProductRouter.sol']['TwoWayConstantProductRouter']
	let factoryV2Artifact: TradingContracts['contracts/trading/TwoWayConstantProductFactoryV2.sol']['TwoWayConstantProductFactoryV2']
	let pairV2Artifact: TradingContracts['contracts/trading/TwoWayConstantProductPairV2.sol']['TwoWayConstantProductPairV2']
	let routerV2Artifact: TradingContracts['contracts/trading/TwoWayConstantProductRouterV2.sol']['TwoWayConstantProductRouterV2']

	async function deploy<TAbi extends Abi>(artifact: Readonly<{ abi: TAbi; evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>, args: readonly unknown[] = []) {
		const hash = await fixture.client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` as Hex, args }) })
		const receipt = await fixture.client.waitForTransactionReceipt({ hash })
		if (receipt.status === 'reverted' || receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Trading deployment failed')
		return receipt.contractAddress
	}

	async function shareBalance(owner: Address, outcome: 0n | 1n | 2n) {
		return await fixture.client.readContract({ abi: fixture.statoblast_tokens_ShareToken_ShareToken.abi, address: fixture.securityPoolAddresses.shareToken, functionName: 'balanceOf', args: [owner, outcome] })
	}

	async function loadPoolAccounting() {
		const address = fixture.securityPoolAddresses.securityPool
		const [shareTokenSupplyAttoShares, mintingCapacityCeilingAttoEth, accounting] = await Promise.all([
			fixture.client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address, functionName: 'shareTokenSupplyAttoShares' }),
			fixture.client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address, functionName: 'getCurrentMintingCapacityAttoEth' }),
			fixture.client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address, functionName: 'getPoolAccountingSnapshot' }),
		])
		return { shareTokenSupplyAttoShares, mintingCapacityCeilingAttoEth, accounting }
	}

	async function deployV2Venue() {
		const factoryV2 = await deploy(factoryV2Artifact, [fixture.getInfraContractAddresses().securityPoolFactory, 30n])
		const legacyRouter = await deploy(routerArtifact, [factoryV2])
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: factoryV2Artifact.abi, address: factoryV2, functionName: 'createPair', args: [fixture.securityPoolAddresses.securityPool] }))
		const pairV2 = await fixture.client.readContract({ abi: factoryV2Artifact.abi, address: factoryV2, functionName: 'getPair', args: [fixture.securityPoolAddresses.securityPool] })
		return { pair: pairV2, router: legacyRouter }
	}

	async function initializeV2Venue(pairV2: Address, routerV2: Address, value = 1n) {
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: fixture.statoblast_tokens_ShareToken_ShareToken.abi, address: fixture.securityPoolAddresses.shareToken, functionName: 'setApprovalForAll', args: [routerV2, true] }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: routerV2, functionName: 'initializeWithEth', args: [pairV2, 5_000n, 1n, account, 10n ** 12n], value }))
	}

	beforeAll(async () => {
		const contracts = await compileArtifactsForTests()
		factoryArtifact = contracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
		pairArtifact = contracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
		routerArtifact = contracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
		factoryV2Artifact = contracts['contracts/trading/TwoWayConstantProductFactoryV2.sol'].TwoWayConstantProductFactoryV2
		pairV2Artifact = contracts['contracts/trading/TwoWayConstantProductPairV2.sol'].TwoWayConstantProductPairV2
		routerV2Artifact = contracts['contracts/trading/TwoWayConstantProductRouterV2.sol'].TwoWayConstantProductRouterV2
	})

	beforeEach(async () => {
		account = fixture.addressString(fixture.TEST_ADDRESSES[0])
		await fixture.manipulatePriceOracleAndPerformOperation(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, fixture.OperationType.PriceRefresh, fixture.client.account.address, fixture.repDeposit / 4n)
		factory = await deploy(factoryArtifact, [fixture.getInfraContractAddresses().securityPoolFactory, 30n])
		router = await deploy(routerArtifact, [factory])
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'createPair', args: [fixture.securityPoolAddresses.securityPool] }))
		pair = await fixture.client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [fixture.securityPoolAddresses.securityPool] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: fixture.statoblast_tokens_ShareToken_ShareToken.abi, address: fixture.securityPoolAddresses.shareToken, functionName: 'setApprovalForAll', args: [router, true] }))
	})

	test('uses the real dynamic complete-set scale and leaves no INVALID or router residue', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 7_000n, 1n, account, deadline], value: 1n }))
		const poolSettings = await loadPoolAccounting()
		expect(poolSettings.shareTokenSupplyAttoShares).toBeGreaterThan(0n)
		expect(poolSettings.accounting.settlementCollateralAttoEth).toBe(1n)
		expect(poolSettings.accounting.totalCapacityOwnershipAttoRep).toBeGreaterThan(0n)
		expect(poolSettings.accounting.feeEligibleCapacityOwnershipAttoRep).toBeGreaterThan(0n)
		expect(poolSettings.mintingCapacityCeilingAttoEth).toBeGreaterThan(0n)
		expect(poolSettings.mintingCapacityCeilingAttoEth - poolSettings.accounting.settlementCollateralAttoEth).toBeGreaterThan(0n)
		expect(await shareBalance(pair, 0n)).toBe(0n)
		const invalidBefore = await shareBalance(account, 0n)
		const expectedMint = await fixture.client.readContract({ abi: attoEthToAttoSharesAbi, address: fixture.securityPoolAddresses.securityPool, functionName: 'attoEthToAttoShares', args: [1n] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, deadline], value: 1n }))
		expect((await shareBalance(account, 0n)) - invalidBefore).toBe(expectedMint)
		expect(await shareBalance(pair, 0n)).toBe(0n)
		expect(await shareBalance(router, 0n)).toBe(0n)
		expect(await shareBalance(router, 1n)).toBe(0n)
		expect(await shareBalance(router, 2n)).toBe(0n)
	})

	test('rejects an insured exit that would burn fractional shares for zero ETH', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 3_000n, 1n, account, deadline], value: 1n }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 1, 1n, account, deadline], value: 1n }))
		const balancesBefore = await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])
		await expect(fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'exitPosition', args: [pair, 1, 1n, (1n << 256n) - 1n, 0n, account, deadline] })).rejects.toThrow('Zero ETH output')
		await expect(fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'redeemCompleteSet', args: [fixture.securityPoolAddresses.securityPool, 1n, 0n, account, deadline] })).rejects.toThrow('Zero ETH output')
		expect(await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])).toEqual(balancesBefore)
	})

	test('keeps LP removal open after the real question end time', async () => {
		const v2 = await deployV2Venue()
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, deadline], value: 1n }))
		await initializeV2Venue(v2.pair, v2.router)
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await expect(fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
		await expect(fixture.client.writeContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
		const v2Liquidity = await fixture.client.readContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'removeLiquidity', args: [v2Liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await fixture.client.readContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await shareBalance(pair, 0n)).toBe(0n)
		expect(await shareBalance(v2.pair, 0n)).toBe(0n)
	})

	test('reports the real finalized outcome and keeps raw LP removal available', async () => {
		const v2 = await deployV2Venue()
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, deadline], value: 1n }))
		await initializeV2Venue(v2.pair, v2.router)
		await fixture.finalizeQuestionAsYesWithoutFork()
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(5n)
		expect(await fixture.client.readContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'tradingStatus' })).toBe(5n)
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
		const v2Liquidity = await fixture.client.readContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'removeLiquidity', args: [v2Liquidity, 1n, 1n, account, 10n ** 12n] }))
	})

	test('stops parent trading after a real universe fork while preserving LP removal', async () => {
		const v2 = await deployV2Venue()
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, deadline], value: 1n }))
		await initializeV2Venue(v2.pair, v2.router)
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await fixture.approveToken(fixture.client, fixture.addressString(fixture.GENESIS_REPUTATION_TOKEN), fixture.getZoltarAddress())
		await fixture.forkUniverse(fixture.client, fixture.genesisUniverse, fixture.questionId)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(4n)
		expect(await fixture.client.readContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'tradingStatus' })).toBe(4n)
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
		const v2Liquidity = await fixture.client.readContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairV2Artifact.abi, address: v2.pair, functionName: 'removeLiquidity', args: [v2Liquidity, 1n, 1n, account, 10n ** 12n] }))
	})

	test('V2 exits and redeems against the real SecurityPool with zero operator approval and exact slippage bounds', async () => {
		const coreFactory = fixture.getInfraContractAddresses().securityPoolFactory
		const factoryV2 = await deploy(factoryV2Artifact, [coreFactory, 30n])
		const legacyRouterForV2 = await deploy(routerArtifact, [factoryV2])
		const receiveRouter = await deploy(routerV2Artifact, [factoryV2])
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: factoryV2Artifact.abi, address: factoryV2, functionName: 'createPair', args: [fixture.securityPoolAddresses.securityPool] }))
		const pairV2 = await fixture.client.readContract({ abi: factoryV2Artifact.abi, address: factoryV2, functionName: 'getPair', args: [fixture.securityPoolAddresses.securityPool] })
		expect(await fixture.client.readContract({ abi: factoryV2Artifact.abi, address: factoryV2, functionName: 'predictPair', args: [fixture.securityPoolAddresses.securityPool] })).toBe(pairV2)
		expect(await fixture.client.readContract({ abi: pairV2Artifact.abi, address: pairV2, functionName: 'factory' })).toBe(factoryV2)
		const deadline = fixture.questionData.endTime - 1n
		const shareTokenAddress = fixture.securityPoolAddresses.shareToken
		const shareTokenAbi = fixture.statoblast_tokens_ShareToken_ShareToken.abi
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'setApprovalForAll', args: [legacyRouterForV2, true] }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: legacyRouterForV2, functionName: 'initializeWithEth', args: [pairV2, 5_000n, 1n, account, deadline], value: 10n }))

		const entry = await fixture.client.simulateContract({ abi: routerArtifact.abi, address: legacyRouterForV2, functionName: 'enterPosition', args: [pairV2, 1, 1n, account, deadline], value: 2n })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: legacyRouterForV2, functionName: 'enterPosition', args: [pairV2, 1, 1n, account, deadline], value: 2n }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'setApprovalForAll', args: [receiveRouter, false] }))
		expect(await fixture.client.readContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'isApprovedForAll', args: [account, receiveRouter] })).toBe(false)

		const universeId = fixture.genesisUniverse
		const ids = [universeId << 8n, (universeId << 8n) | 1n, (universeId << 8n) | 2n] as const
		// A round trip pays two AMM fees, so exiting the full entry amount would
		// require more long shares than the account received. Exit half and send
		// the full balance as the bound to also exercise the refund path.
		const exitAmount = entry.result.completeSetShares / 2n
		expect(exitAmount).toBeGreaterThan(0n)
		expect(await fixture.client.readContract({ abi: pairV2Artifact.abi, address: pairV2, functionName: 'universeId' })).toBe(universeId)
		expect(await fixture.client.readContract({ abi: pairV2Artifact.abi, address: pairV2, functionName: 'questionId' })).toBe(fixture.questionId)
		expect(await fixture.client.readContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'canonicalPoolByUniverse', args: [universeId] })).toBe(fixture.securityPoolAddresses.securityPool)
		expect(await shareBalance(account, 0n)).toBeGreaterThanOrEqual(exitAmount)
		expect(await shareBalance(account, 1n)).toBeGreaterThanOrEqual(entry.result.totalLongShares)
		const exactExitEth = await fixture.client.readContract({ abi: attoSharesToAttoEthAbi, address: fixture.securityPoolAddresses.securityPool, functionName: 'attoSharesToAttoEth', args: [exitAmount] })
		const acceptedMinimumEth = exactExitEth
		expect(acceptedMinimumEth).toBeGreaterThan(0n)
		const exitData = (minimumEth: bigint) => encodeAbiParameters([receiveRequestParameter], [[1, 0, shareTokenAddress, fixture.securityPoolAddresses.securityPool, pairV2, universeId, fixture.questionId, ids[0], ids[1], ids[2], 1, exitAmount, entry.result.totalLongShares, minimumEth, account, account, deadline]])
		const balancesBeforeSlippage = await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])
		await expect(fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'safeBatchTransferFrom', args: [account, receiveRouter, [ids[0], ids[1]], [exitAmount, entry.result.totalLongShares], exitData(exactExitEth + 1n)] })).rejects.toThrow()
		expect(await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])).toEqual(balancesBeforeSlippage)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'safeBatchTransferFrom', args: [account, receiveRouter, [ids[0], ids[1]], [exitAmount, entry.result.totalLongShares], exitData(acceptedMinimumEth)] }))
		for (const outcome of [0n, 1n, 2n] as const) expect(await shareBalance(receiveRouter, outcome)).toBe(0n)

		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: fixture.securityPoolAddresses.securityPool, functionName: 'createCompleteSet', value: 1n }))
		const redeemAmount = await fixture.client.readContract({ abi: attoEthToAttoSharesAbi, address: fixture.securityPoolAddresses.securityPool, functionName: 'attoEthToAttoShares', args: [1n] })
		const redeemEth = await fixture.client.readContract({ abi: attoSharesToAttoEthAbi, address: fixture.securityPoolAddresses.securityPool, functionName: 'attoSharesToAttoEth', args: [redeemAmount] })
		const redeemData = encodeAbiParameters([receiveRequestParameter], [[1, 1, shareTokenAddress, fixture.securityPoolAddresses.securityPool, pairV2, universeId, fixture.questionId, ids[0], ids[1], ids[2], 3, redeemAmount, 0n, redeemEth, account, account, deadline]])
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'safeBatchTransferFrom', args: [account, receiveRouter, ids, [redeemAmount, redeemAmount, redeemAmount], redeemData] }))
		for (const outcome of [0n, 1n, 2n] as const) expect(await shareBalance(receiveRouter, outcome)).toBe(0n)
	})
})
