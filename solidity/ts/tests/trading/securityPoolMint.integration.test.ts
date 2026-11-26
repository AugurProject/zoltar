import { loadMintPurchaseQuote } from '../../../../ui/trading/ts/protocol/mintPurchaseQuote.js'
import { describe, expect, test } from 'bun:test'
import { estimateMintCheckpoint } from '../../../../ui/statoblastShared/ts/features/markets/lib/trading.js'
import { readRequiredMulticall } from '../../../../ui/zoltarShared/ts/protocol/core.js'
import { ReputationToken_ReputationToken as erc20Artifact, statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact } from '../../types/contractArtifact'
import { loadCentralSecurityPoolQuestion } from '../../../../ui/statoblastShared/ts/protocol/securityPoolState.js'
import { loadMintFees } from '../../../../ui/trading/ts/protocol/minting.js'
import { securityPoolMintFee, securityPoolMintForQuotedBudget, securityPoolMintWithinBudget } from '@zoltar/trading-shared/trading/securityPoolMint'
import { encodeDeployData, maxUint256 } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import {
	trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryArtifact,
	trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_tokens_ShareToken_ShareToken as sharesArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
} from '../../types/contractArtifact'
import { unit, useSecurityPoolFixture } from '../statoblast/securityPoolFixture'

describe('Trading: security-pool-funded complete sets', () => {
	const fixture = useSecurityPoolFixture()
	test.each([0n, 30n, 120n])('#1557 quoted fee equals charged fee without router collateral or approval residue (elapsed: %s)', async elapsed => {
		await fixture.prepare()
		const owner = fixture.owner()
		const native = fixture.poolFor(fixture.base.questionId)
		await fixture.mint(unit)
		await fixture.base.mockWindow.advanceTime(elapsed)
		const factory = await deployContract(owner, encodeDeployData({ abi: factoryArtifact.abi, bytecode: `0x${factoryArtifact.evm.bytecode.object}`, args: [getInfraContractAddresses().securityPoolFactory, 30n] }))
		const router = await deployContract(owner, encodeDeployData({ abi: routerArtifact.abi, bytecode: `0x${routerArtifact.evm.bytecode.object}`, args: [factory] }))
		const [fee] = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, unit] })
		await writeContractAndWait(owner, () =>
			owner.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithEth', args: [native.questionLedger, unit, 5_000n, maxUint256, maxUint256, 0n, 0n, 1n, owner.account.address, fixture.base.questionData.endTime - 1n], value: unit + fee + unit / 10n }),
		)
		expect(await owner.getBalance({ address: router })).toBe(0n)
		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const services = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		expect(await owner.readContract({ abi: erc20Artifact.abi, address: collateral, functionName: 'balanceOf', args: [router] })).toBe(0n)
		expect(await owner.readContract({ abi: erc20Artifact.abi, address: collateral, functionName: 'allowance', args: [router, services] })).toBe(0n)
		for (const outcome of [0n, 1n, 2n]) expect(await owner.readContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'balanceOf', args: [router, outcome] })).toBe(0n)
		const pair = await owner.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [native.questionLedger] })
		expect(await owner.readContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'balanceOf', args: [pair, 1n] })).toBeGreaterThan(0n)
	})
	test('rejects an underfunded fee budget atomically and funds entries and additions without retained ETH', async () => {
		await fixture.prepare()
		const owner = fixture.owner()
		const native = fixture.poolFor(fixture.base.questionId)
		const factory = await deployContract(owner, encodeDeployData({ abi: factoryArtifact.abi, bytecode: `0x${factoryArtifact.evm.bytecode.object}`, args: [getInfraContractAddresses().securityPoolFactory, 30n] }))
		const router = await deployContract(owner, encodeDeployData({ abi: routerArtifact.abi, bytecode: `0x${routerArtifact.evm.bytecode.object}`, args: [factory] }))
		const deadline = fixture.base.questionData.endTime - 1n
		await expect(owner.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithEth', args: [native.questionLedger, unit, 5_000n, maxUint256, maxUint256, 0n, 0n, 1n, owner.account.address, deadline], value: unit })).rejects.toThrow('Purchase fee exceeds budget')
		expect(await owner.readContract({ abi: poolArtifact.abi, address: native.questionLedger, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithEth', args: [native.questionLedger, unit, 5_000n, maxUint256, maxUint256, 0n, 0n, 1n, owner.account.address, deadline], value: 2n * unit }))
		const pair = await owner.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [native.questionLedger] })
		const entry = { abi: routerArtifact.abi, address: router, functionName: 'enterPosition' as const, args: [pair, unit, 1, 1n, owner.account.address, deadline] as const, value: 2n * unit }
		const quote = await owner.simulateContract(entry)
		expect(quote.result.ethSpent).toBeGreaterThan(unit)
		expect(quote.result.ethSpent).toBeLessThan(2n * unit)
		await writeContractAndWait(owner, () => owner.writeContract(entry))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, unit, 2n ** 256n - 1n, 2n ** 256n - 1n, 1n, owner.account.address, deadline], value: 2n * unit }))
		expect(await owner.getBalance({ address: router })).toBe(0n)
		for (const outcome of [0n, 1n, 2n]) expect(await owner.readContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'balanceOf', args: [router, outcome] })).toBe(0n)
	})

	test('off-chain fee arithmetic matches checkpointed contract quotes before and after fee accrual', async () => {
		await fixture.prepare()
		const owner = fixture.owner()
		const native = fixture.poolFor(fixture.base.questionId)
		for (const elapsed of [0n, 30n, 120n]) {
			if (elapsed !== 0n) {
				await fixture.mint(unit)
				await fixture.base.mockWindow.setTime((await fixture.base.mockWindow.getTime()) + elapsed)
			}
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: native.questionLedger, functionName: 'refreshSecurityPoolFees' }))
			const blockNumber = await owner.getBlockNumber()
			const central = await loadCentralSecurityPoolQuestion(owner, native.questionLedger, fixture.capitalLedger, blockNumber)
			const state = { ...(await loadMintFees(owner, central, blockNumber)), cashAttoEth: central.settlementCollateralAttoEth, outcomeSupplyAttoShares: central.shareTokenSupplyAttoShares }
			for (const cash of [1n, unit / 100n, unit, 3n * unit + 1n]) {
				const [fee] = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash], blockNumber })
				expect(securityPoolMintFee(cash, state)).toBe(fee)
				const budget = cash + fee
				expect(securityPoolMintWithinBudget(budget, state)).toBe(cash)
			}
		}
	})

	test('#1640 exact budgets use checkpointed fees with fractional book remainders', async () => {
		await fixture.prepare()
		await fixture.mint(1_000_000n)
		await fixture.base.mockWindow.advanceTime(631n)
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		const block = await owner.getBlockNumber()
		const market = { pool, universeId: fixture.base.genesisUniverse, questionId: fixture.base.questionId }
		const cash = 1_751_990_000n
		const quote = await loadMintPurchaseQuote(owner, market, fixture.securityPool, cash, block)
		const budget = cash + quote.fee
		const result = await securityPoolMintForQuotedBudget(budget, cash, async amount => (await loadMintPurchaseQuote(owner, market, fixture.securityPool, amount, block)).fee)
		expect(result).toEqual({ cash, fee: quote.fee })
		expect(result.cash + result.fee).toBe(budget)
	})

	test('central reads simulate accrued fees at their pinned block without a prior checkpoint transaction', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		await fixture.base.mockWindow.advanceTime(120n)
		const blockNumber = await owner.getBlockNumber()
		const before = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool], blockNumber })
		const [, expected] = await readRequiredMulticall(
			owner,
			[
				{ abi: poolArtifact.abi, address: pool, functionName: 'refreshSecurityPoolFees', args: [] },
				{ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool] },
			],
			blockNumber,
		)
		expect(expected.questionCashAttoEth).toBeLessThan(before.questionCashAttoEth)
		const loaded = await loadCentralSecurityPoolQuestion(owner, pool, fixture.capitalLedger, blockNumber)
		expect(loaded.settlementCollateralAttoEth).toBe(expected.questionCashAttoEth)
		const projection = estimateMintCheckpoint({ ...loaded, currentTimestamp: loaded.centralCheckpointTimestamp + 30n * 86_400n })
		if (projection === undefined) throw new Error('Expected central fee projection')
		expect(projection.estimatedRetentionFeeAttoEth).toBeGreaterThan(0n)
		expect(projection.settlementCollateralAfterFeesAttoEth).toBeLessThan(loaded.settlementCollateralAttoEth)
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool], blockNumber })).toEqual(before)
	})
})
