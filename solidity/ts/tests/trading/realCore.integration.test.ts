import { encodeReceiveBasedRedeemRequest } from '../../../../ui/trading/ts/protocol/authorization.js'
import { encodeReceiveRequest } from '@zoltar/trading-shared/trading/receiveRequest'
import { getZoltarAddress, forkUniverse } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { loadCentralPortfolioQuestion } from '../../../../ui/statoblastShared/ts/protocol/securityPoolPortfolioState.js'
import { TEST_ADDRESSES, GENESIS_REPUTATION_TOKEN } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { statoblast_tokens_ShareToken_ShareToken } from '../../types/contractArtifact'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Abi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useSecurityPoolPortfolioFixture } from '../statoblast/securityPoolPortfolioFixture'
import { statoblast_EscalationGame_EscalationGame as gameArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { ensureDefined } from '../../testSupport/simulator/utils/testUtils'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { compileArtifactsForTests } from './compileArtifactsForTests'

type TradingContracts = Awaited<ReturnType<typeof compileArtifactsForTests>>
// Enough shares to exceed the 1,000-unit LP lock. Fee-bearing purchases are covered separately.
const unit = 1_000_000n
const attoEthToAttoSharesAbi = [{ type: 'function', name: 'attoEthToAttoShares', stateMutability: 'view', inputs: [{ name: 'amountAttoEth', type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi
const attoSharesToAttoEthAbi = [{ type: 'function', name: 'attoSharesToAttoEth', stateMutability: 'view', inputs: [{ name: 'amountAttoShares', type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi

describe('trading against authoritative Zoltar contracts', () => {
	const portfolio = useSecurityPoolPortfolioFixture({ purchaseFeeBps: 0n, annualFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })
	const fixture = portfolio.base
	const native = () => portfolio.poolFor(fixture.questionId)
	let account: Address
	let factory: Address
	let router: Address
	let pair: Address
	let factoryArtifact: TradingContracts['contracts/trading/TwoWayConstantProductFactory.sol']['TwoWayConstantProductFactory']
	let pairArtifact: TradingContracts['contracts/trading/TwoWayConstantProductPair.sol']['TwoWayConstantProductPair']
	let routerArtifact: TradingContracts['contracts/trading/TwoWayConstantProductRouter.sol']['TwoWayConstantProductRouter']

	const deploy = async (artifact: Readonly<{ abi: Abi; evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>, args: readonly unknown[] = []) => await deployContract(fixture.client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args }))

	async function shareBalance(owner: Address, outcome: 0n | 1n | 2n) {
		return await fixture.client.readContract({ abi: statoblast_tokens_ShareToken_ShareToken.abi, address: native().shareToken, functionName: 'balanceOf', args: [owner, outcome] })
	}

	async function loadPoolAccounting() {
		const address = native().securityPool
		const accounting = await loadCentralPortfolioQuestion(fixture.client, address, portfolio.capitalLedger, await fixture.client.getBlockNumber())
		return { shareTokenSupplyAttoShares: accounting.shareTokenSupplyAttoShares, mintingCapacityCeilingAttoEth: accounting.mintingCapacityAttoEth, accounting }
	}

	beforeAll(async () => {
		const contracts = await compileArtifactsForTests()
		factoryArtifact = contracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
		pairArtifact = contracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
		routerArtifact = contracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
	})

	beforeEach(async () => {
		account = addressString(TEST_ADDRESSES[0])
		await portfolio.prepare()
		factory = await deploy(factoryArtifact, [getInfraContractAddresses().securityPoolFactory, 30n])
		router = await deploy(routerArtifact, [factory])
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'createPair', args: [native().securityPool] }))
		pair = await fixture.client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [native().securityPool] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: statoblast_tokens_ShareToken_ShareToken.abi, address: native().shareToken, functionName: 'setApprovalForAll', args: [router, true] }))
	})

	test('uses the real dynamic complete-set scale and leaves no INVALID or router residue', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, unit, 7_000n, 1n, account, deadline], value: unit }))
		const poolSettings = await loadPoolAccounting()
		expect(poolSettings.shareTokenSupplyAttoShares).toBeGreaterThan(0n)
		expect(poolSettings.accounting.settlementCollateralAttoEth).toBe(unit)
		expect(poolSettings.accounting.totalUnderwritingLimitAttoEth).toBeGreaterThan(0n)
		expect(poolSettings.accounting.feeEligibleUnderwritingLimitAttoEth).toBeGreaterThan(0n)
		expect(poolSettings.mintingCapacityCeilingAttoEth).toBeGreaterThan(0n)
		expect(poolSettings.mintingCapacityCeilingAttoEth - poolSettings.accounting.settlementCollateralAttoEth).toBeGreaterThan(0n)
		expect(await shareBalance(pair, 0n)).toBe(0n)
		const invalidBefore = await shareBalance(account, 0n)
		const expectedMint = await fixture.client.readContract({ abi: attoEthToAttoSharesAbi, address: native().securityPool, functionName: 'attoEthToAttoShares', args: [unit] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, unit, 1, 1n, account, deadline], value: unit }))
		expect((await shareBalance(account, 0n)) - invalidBefore).toBe(expectedMint)
		expect(await shareBalance(pair, 0n)).toBe(0n)
		expect(await shareBalance(router, 0n)).toBe(0n)
		expect(await shareBalance(router, 1n)).toBe(0n)
		expect(await shareBalance(router, 2n)).toBe(0n)
	})

	test('keeps LP removal open after the real question end time', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, unit, 5_000n, 1n, account, deadline], value: unit }))
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await expect(fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await shareBalance(pair, 0n)).toBe(0n)
	})

	test('reports the real finalized outcome and keeps raw LP removal available', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, unit, 5_000n, 1n, account, deadline], value: unit }))
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await approveToken(fixture.client, addressString(GENESIS_REPUTATION_TOKEN), native().securityPool)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: native().securityPool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * 10n ** 18n] }))
		const game = await fixture.client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: native().securityPool, functionName: 'escalationGame' })
		const end = await fixture.client.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.mockWindow.setTime(end + 60n)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(5n)
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
	})

	test('stops parent trading after a real universe fork while preserving LP removal', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, unit, 5_000n, 1n, account, deadline], value: unit }))
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await approveToken(fixture.client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(fixture.client, fixture.genesisUniverse, fixture.questionId)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(4n)
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
	})

	test('exits and redeems against the real SecurityPool with zero operator approval and exact slippage bounds', async () => {
		expect(await fixture.client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'predictPair', args: [native().securityPool] })).toBe(pair)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'factory' })).toBe(factory)
		const deadline = fixture.questionData.endTime - 1n
		const shareTokenAddress = native().shareToken
		const shareTokenAbi = statoblast_tokens_ShareToken_ShareToken.abi
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 10n * unit, 5_000n, 1n, account, deadline], value: 10n * unit }))

		const entry = await fixture.client.simulateContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 2n * unit, 1, 1n, account, deadline], value: 2n * unit })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'enterPosition', args: [pair, 2n * unit, 1, 1n, account, deadline], value: 2n * unit }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'setApprovalForAll', args: [router, false] }))
		expect(await fixture.client.readContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'isApprovedForAll', args: [account, router] })).toBe(false)

		const universeId = fixture.genesisUniverse
		const ids = [universeId << 8n, (universeId << 8n) | 1n, (universeId << 8n) | 2n] as const
		// A round trip pays two AMM fees, so exiting the full entry amount would
		// require more long shares than the account received. Exit half and send
		// the full balance as the bound to also exercise the refund path.
		const exitAmount = entry.result.completeSetShares / 2n
		expect(exitAmount).toBeGreaterThan(0n)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'universeId' })).toBe(universeId)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'questionId' })).toBe(fixture.questionId)
		expect(await fixture.client.readContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'canonicalPoolByUniverse', args: [universeId] })).toBe(native().securityPool)
		expect(await shareBalance(account, 0n)).toBeGreaterThanOrEqual(exitAmount)
		expect(await shareBalance(account, 1n)).toBeGreaterThanOrEqual(entry.result.totalLongShares)
		const exactExitEth = await fixture.client.readContract({ abi: attoSharesToAttoEthAbi, address: native().securityPool, functionName: 'attoSharesToAttoEth', args: [exitAmount] })
		const acceptedMinimumEth = exactExitEth
		expect(acceptedMinimumEth).toBeGreaterThan(0n)
		const exitData = (minimumEth: bigint) => encodeReceiveRequest([1, 0, shareTokenAddress, native().securityPool, pair, universeId, fixture.questionId, ids[0], ids[1], ids[2], 1, exitAmount, entry.result.totalLongShares, minimumEth, account, account, deadline])
		const balancesBeforeSlippage = await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])
		await expect(fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'safeBatchTransferFrom', args: [account, router, [ids[0], ids[1]], [exitAmount, entry.result.totalLongShares], exitData(exactExitEth + 1n)] })).rejects.toThrow()
		expect(await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])).toEqual(balancesBeforeSlippage)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'safeBatchTransferFrom', args: [account, router, [ids[0], ids[1]], [exitAmount, entry.result.totalLongShares], exitData(acceptedMinimumEth)] }))
		for (const outcome of [0n, 1n, 2n] as const) expect(await shareBalance(router, outcome)).toBe(0n)

		await portfolio.mint(unit, fixture.questionId, { sender: fixture.client })
		const redeemAmount = await fixture.client.readContract({ abi: attoEthToAttoSharesAbi, address: native().securityPool, functionName: 'attoEthToAttoShares', args: [unit] })
		const redeemEth = await fixture.client.readContract({ abi: attoSharesToAttoEthAbi, address: native().securityPool, functionName: 'attoSharesToAttoEth', args: [redeemAmount] })
		const recipient = addressString(TEST_ADDRESSES[1])
		const recipientEthBefore = await fixture.client.getBalance({ address: recipient })
		const supplies = () => Promise.all(ids.map(id => fixture.client.readContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'totalSupply', args: [id] })))
		const supplyBefore = await supplies()
		const sharesBefore = await Promise.all([shareBalance(account, 0n), shareBalance(account, 1n), shareBalance(account, 2n)])
		const redeemData = encodeReceiveBasedRedeemRequest({ shareToken: shareTokenAddress, pool: native().securityPool, pair, universeId, questionId: fixture.questionId }, redeemAmount, redeemEth, recipient, deadline)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: shareTokenAbi, address: shareTokenAddress, functionName: 'safeBatchTransferFrom', args: [account, router, ids, [redeemAmount, redeemAmount, redeemAmount], redeemData] }))
		for (const outcome of [0n, 1n, 2n] as const) expect(await shareBalance(router, outcome)).toBe(0n)
		for (const outcome of [0n, 1n, 2n] as const) expect(await shareBalance(account, outcome)).toBe(ensureDefined(sharesBefore[Number(outcome)], 'missing share balance before redeem') - redeemAmount)
		expect(await supplies()).toEqual(supplyBefore.map(supply => supply - redeemAmount))
		expect((await fixture.client.getBalance({ address: recipient })) - recipientEthBefore).toBe(redeemEth)
		expect(await fixture.client.getBalance({ address: router })).toBe(0n)
	})
})
