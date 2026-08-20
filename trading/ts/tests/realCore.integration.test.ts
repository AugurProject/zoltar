import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Abi, type Address, type Hex } from '@zoltar/shared/ethereum'
import { useStatoblastVaultAccountingFixture } from '../../../solidity/ts/tests/statoblast/fixture.ts'
import { writeContractAndWait } from '../../../solidity/ts/testSupport/simulator/utils/clients.ts'
import { loadLiveSecurityPoolSettings } from '../../ui/ts/protocol/live.ts'
import { compileArtifactsForTests } from './compileArtifactsForTests.ts'

type TradingContracts = typeof import('../artifacts/contractArtifact.ts').tradingContracts
const attoEthToAttoSharesAbi = [{ type: 'function', name: 'attoEthToAttoShares', stateMutability: 'view', inputs: [{ name: 'amountAttoEth', type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const satisfies Abi

describe('trading against authoritative Zoltar contracts', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	let account: Address
	let factory: Address
	let router: Address
	let pair: Address
	let factoryArtifact: TradingContracts['trading/contracts/TwoWayConstantProductFactory.sol']['TwoWayConstantProductFactory']
	let pairArtifact: TradingContracts['trading/contracts/TwoWayConstantProductPair.sol']['TwoWayConstantProductPair']
	let routerArtifact: TradingContracts['trading/contracts/TwoWayConstantProductRouter.sol']['TwoWayConstantProductRouter']

	async function deploy<TAbi extends Abi>(artifact: Readonly<{ abi: TAbi; evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>, args: readonly unknown[] = []) {
		const hash = await fixture.client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` as Hex, args }) })
		const receipt = await fixture.client.waitForTransactionReceipt({ hash })
		if (receipt.status === 'reverted' || receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Trading deployment failed')
		return receipt.contractAddress
	}

	async function shareBalance(owner: Address, outcome: 0n | 1n | 2n) {
		return await fixture.client.readContract({ abi: fixture.statoblast_tokens_ShareToken_ShareToken.abi, address: fixture.securityPoolAddresses.shareToken, functionName: 'balanceOf', args: [owner, outcome] })
	}

	beforeAll(async () => {
		const contracts = await compileArtifactsForTests()
		factoryArtifact = contracts['trading/contracts/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
		pairArtifact = contracts['trading/contracts/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
		routerArtifact = contracts['trading/contracts/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
	}, 120_000)

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
		const poolSettings = await loadLiveSecurityPoolSettings(fixture.client, fixture.securityPoolAddresses.securityPool)
		expect(poolSettings.shareTokenSupplyAttoShares).toBeGreaterThan(0n)
		expect(poolSettings.settlementCollateralAttoEth).toBe(1n)
		expect(poolSettings.totalCapacityOwnershipAttoRep).toBeGreaterThan(0n)
		expect(poolSettings.feeEligibleCapacityOwnershipAttoRep).toBeGreaterThan(0n)
		expect(poolSettings.mintingCapacityCeilingAttoEth).toBeGreaterThan(0n)
		expect(poolSettings.availableMintingCapacityAttoEth).toBe(poolSettings.mintingCapacityCeilingAttoEth - poolSettings.settlementCollateralAttoEth)
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
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, deadline], value: 1n }))
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await expect(fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [true, 1n, 0n, account] })).rejects.toThrow('Question ended')
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })).toBe(0n)
		expect(await shareBalance(pair, 0n)).toBe(0n)
	})

	test('reports the real finalized outcome and keeps raw LP removal available', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, deadline], value: 1n }))
		await fixture.finalizeQuestionAsYesWithoutFork()
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(5n)
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
	})

	test('stops parent trading after a real universe fork while preserving LP removal', async () => {
		const deadline = fixture.questionData.endTime - 1n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'initializeWithEth', args: [pair, 5_000n, 1n, account, deadline], value: 1n }))
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await fixture.approveToken(fixture.client, fixture.addressString(fixture.GENESIS_REPUTATION_TOKEN), fixture.getZoltarAddress())
		await fixture.forkUniverse(fixture.client, fixture.genesisUniverse, fixture.questionId)
		expect(await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(4n)
		const liquidity = await fixture.client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account] }))
	})
})
