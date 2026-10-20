import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getOpenOracleReportMeta, getPendingReportId, getRequestPriceCostAttoEth, openOracleSettle, requestPriceWithValue } from '../../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: central capital shared price feed', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const feed = () => fixture.owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })

	test('report exposure follows direct capital authorizations without a question synchronization transaction', async () => {
		await fixture.deposit(1_000n * unit)
		await fixture.refreshPrice()
		const shared = await feed()
		const exposure = () => fixture.owner().readContract({ abi: feedArtifact.abi, address: shared, functionName: 'aggregateExposureAttoEth' })
		const minimum = () => fixture.owner().readContract({ abi: feedArtifact.abi, address: shared, functionName: 'minimumToken1ReportAttoEth' })
		expect(await exposure()).toBe(0n)
		await fixture.authorize(500n * unit, 100n * unit)
		expect(await exposure()).toBe(100n * unit)
		const firstMinimum = await minimum()
		expect(firstMinimum).toBeGreaterThan(unit)
		await fixture.authorize(1_000n * unit, 200n * unit)
		expect(await exposure()).toBe(200n * unit)
		expect(await minimum()).toBeGreaterThan(firstMinimum)
		for (const question of [fixture.base.questionId, fixture.secondQuestionId]) {
			const coordinator = fixture.poolFor(question).openOraclePriceCoordinator
			expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'minimumToken1ReportAttoEth' })).toBe(await minimum())
			await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: feedArtifact.abi, address: shared, functionName: 'syncExposure', args: [coordinator] }))
		}
		expect(await exposure()).toBe(200n * unit)
	})

	test('one accepted report sets the same price and expiry for capital and every question', async () => {
		await fixture.refreshPrice(fixture.secondQuestionId, 2n * unit)
		const shared = await feed()
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: shared, functionName: 'lastPrice' })).toBe(2n * unit)
		expect(await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'acceptedPrice' })).toBe(2n * unit)
		const settled = await fixture.owner().readContract({ abi: feedArtifact.abi, address: shared, functionName: 'lastSettlementTimestamp' })
		for (const question of [fixture.base.questionId, fixture.secondQuestionId]) {
			const target = { abi: coordinatorArtifact.abi, address: fixture.poolFor(question).openOraclePriceCoordinator }
			expect(await fixture.owner().readContract({ ...target, functionName: 'isPriceValid' })).toBe(true)
			expect(await fixture.owner().readContract({ ...target, functionName: 'lastSettlementTimestamp' })).toBe(settled)
		}
		expect(await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'priceValidUntil' })).toBe(settled + 300n)
	})

	test('a real oracle callback checkpoints 768 positions, 128 question histories and expired dual-token earnings within its gas budget', async () => {
		const owner = fixture.owner()
		const mock = fixture.base.mockWindow
		const universe = fixture.base.genesisUniverse
		await fixture.refreshPrice(fixture.base.questionId, unit + 127n)
		const settlement = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [universe] })
		const now = (await owner.getBlock()).timestamp
		const root = createWriteClient(mock, BigInt(fixture.portfolio))
		// Privileged setup creates a funded imported state through production APIs.
		// Only setup impersonates the authority; the measured report is fully native.
		await mock.impersonateAccount(fixture.portfolio)
		await mock.setBalance(fixture.portfolio, 1_000n * unit)
		await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'beginForkImport' }))
		let backing = 0n
		let positionSetupGas = 0n
		for (let i = 0; i < 256; i++) {
			const rep = 2n * (unit + BigInt(i))
			const holder =
				i === 0
					? owner.account.address
					: getAddress(
							`0x${BigInt(10_000 + i)
								.toString(16)
								.padStart(40, '0')}`,
						)
			const positions = [0n, 1n, 2n].map(batch => ({ rep, commitment: unit, batch, executionReserveAttoEth: unit / 10_000n }))
			const [active, current, next] = positions
			if (active === undefined || current === undefined || next === undefined) throw new Error('Missing stress cohort')
			const hash = await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'importChoice', args: [holder, [active, current, next], 10_000n], value: (3n * unit) / 10_000n }))
			positionSetupGas += (await root.waitForTransactionReceipt({ hash })).gasUsed
			backing += 3n * rep
		}
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(universe), functionName: 'transfer', args: [fixture.capitalLedger, backing] }))
		for (let i = 0; i < 128; i++) {
			const pool = getAddress(
				`0x${BigInt(100_000 + i)
					.toString(16)
					.padStart(40, '0')}`,
			)
			const questionId = 1n << BigInt(i * 2)
			await writeContractAndWait(root, () => root.writeContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'registerQuestion', args: [pool, universe, questionId] }))
			await writeContractAndWait(root, () => root.writeContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'mint', args: [pool, 0n, now], value: unit }))
			if (i % 3 === 0) {
				await writeContractAndWait(root, () => root.writeContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'scheduleFinality', args: [pool, now + 500n + (1n << BigInt(i % 47)), now] }))
			} else {
				await writeContractAndWait(root, () => root.writeContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'replaceFeeStream', args: [pool, 1_000n + BigInt(i), now + 500n + (1n << BigInt(i % 47)), now] }))
			}
		}
		await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'finishForkImport', args: [128n * unit] }))
		const validUntil = Number((await owner.getBlock()).timestamp + 1_000n)
		// Leave an older whole-tree observation above newer partial-range stamps.
		for (const price of [unit, unit + 127n]) await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'acceptPrice', args: [price, validUntil] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(universe), functionName: 'transfer', args: [fixture.portfolio, unit] }))
		await writeContractAndWait(root, () => root.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(universe), functionName: 'approve', args: [fixture.capitalLedger, unit] }))
		await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'fundVestedFees', args: [unit], value: unit }))
		expect((await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'totals' }))[1]).toBe(768n * unit)
		expect((await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] }))[0]).toBeGreaterThan(0n)
		await mock.advanceTime(86_401n)
		const coordinator = fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator
		await requestPriceWithValue(owner, coordinator, await getRequestPriceCostAttoEth(owner, coordinator), unit + 129n)
		const reportId = await getPendingReportId(owner, coordinator)
		const meta = await getOpenOracleReportMeta(owner, reportId)
		await mock.advanceTime(BigInt(meta.settlementTime) + 1n)
		const hash = await openOracleSettle(owner, reportId)
		const receipt = await owner.waitForTransactionReceipt({ hash })
		const shared = await feed()
		expect(await owner.readContract({ abi: feedArtifact.abi, address: shared, functionName: 'reportOutcome', args: [reportId] })).toBe(1n)
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'acceptedPrice' })).toBe(unit + 129n)
		const budget = await owner.readContract({ abi: feedArtifact.abi, address: shared, functionName: 'getSettlementCallbackGasLimit' })
		expect(receipt.gasUsed).toBeLessThan(budget)
		const claimHash = await writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'claimEarnings' }))
		const taggedOwnerClaimGas = (await owner.waitForTransactionReceipt({ hash: claimHash })).gasUsed
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ composedOracleSettlementGas: receipt.gasUsed, callbackGasBudget: budget, positionSetupGas, taggedOwnerClaimGas })
		// This full claim also checkpoints the live settlement book and fee clocks.
		// The index-only three-cohort claim retains its separate component budget.
		expect(taggedOwnerClaimGas).toBeLessThan(5_000_000n)
	})

	test('a different portfolio has its own price clock and cannot register into this namespace', async () => {
		await fixture.refreshPrice()
		const second = await fixture.deployPortfolio()
		await fixture.register(fixture.base.questionId, second)
		const secondFeed = await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: second, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		expect(secondFeed).not.toBe(await feed())
		expect(await fixture.owner().readContract({ abi: feedArtifact.abi, address: secondFeed, functionName: 'lastPrice' })).toBe(0n)
		await expect(fixture.other().writeContract({ abi: feedArtifact.abi, address: await feed(), functionName: 'registerCoordinator', args: [fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator] })).rejects.toThrow('Only security pool factory')
		const factory = { abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory }
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...factory, functionName: 'initializePortfolioPriceFeed', args: [fixture.base.securityPoolAddresses.securityPool] }))
		const ownNamespace = await fixture.other().readContract({ ...factory, functionName: 'sharedPriceFeeds', args: [fixture.other().account.address, fixture.base.genesisUniverse] })
		expect(ownNamespace).not.toBe(await feed())
		expect(await fixture.owner().readContract({ ...factory, functionName: 'sharedPriceFeeds', args: [fixture.portfolio, fixture.base.genesisUniverse] })).toBe(await feed())
	})
})
