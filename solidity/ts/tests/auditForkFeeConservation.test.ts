import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
} from '../types/contractArtifact'
import { DAY } from '../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// At the fork instant every collateral token is in exactly one accounted bucket, whether
// the capital price was fresh or stale when the universe forked.
describe('audit: fee conservation at the fork instant', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test.each([{ stale: false }, { stale: true }])('no fee is stranded when the price is stale=$stale at the fork', async ({ stale }) => {
		const { base } = fixture
		const owner = fixture.owner()
		const trader = fixture.other()
		const p = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		await fixture.prepare()
		await fixture.mint(10n * unit, base.questionId)
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		const collateral = await owner.readContract({ ...p, functionName: 'collateralToken' })
		const engine = await owner.readContract({ ...p, functionName: 'settlement' })
		const services = await owner.readContract({ ...p, functionName: 'services' })
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const book = { abi: bookArtifact.abi, address: await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' }) }
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...p, functionName: 'forkController' }) }
		const premiumBook = { abi: premiumArtifact.abi, address: await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'premiumLedger' }) }
		const cash = (holder: Address) => getERC20Balance(owner, collateral, holder)
		const validUntil = BigInt(await owner.readContract({ ...capital, functionName: 'priceValidUntil' }))
		const now = await base.mockWindow.getTime()
		// Let holding fees accrue, then fork either inside or after the validity window.
		if (stale) await base.mockWindow.setTime(validUntil + 5n * DAY)
		else await base.mockWindow.setTime(now + (validUntil - now) / 2n)
		const data = { ...base.questionData, title: `Audit fee fork ${stale}`, endTime: (await base.mockWindow.getTime()) - 1n }
		await createQuestion(owner, data, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(data, base.outcomes))
		await base.mockWindow.advanceTime(3n * DAY)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'freeze', args: [base.genesisUniverse] }))
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [base.genesisUniverse] })
		const totals = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
		const fork = await owner.readContract({ ...coordinator, functionName: 'forks', args: [base.genesisUniverse] })
		const after = { engine: await cash(engine), services: await cash(services), portfolio: await cash(fixture.portfolio), coordinator: await cash(coordinator.address) }
		const premiumTotal = await owner.readContract({ ...premiumBook, functionName: 'totalCash' })
		const streams = { abi: streamsArtifact.abi, address: await owner.readContract({ ...capital, functionName: 'feeStreams' }) }
		// Sealing strands nothing in the portfolio or the coordinator.
		expect(after.portfolio).toBe(0n)
		expect(after.coordinator).toBe(0n)
		// The sealed book holds no uncollected fee escrow.
		expect(totals[2]).toBe(0n)
		// Settlement also retains collected fees until an assigned payout needs cash.
		const pendingSettlementFees = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'pendingServiceFees' })
		expect(after.engine).toBe(totals[0] + pendingSettlementFees)
		expect(fork[2]).toBe(totals[0])
		// Service custody includes earned-but-unpaid income and quarantined burns;
		// the settlement portion of that income has not moved into services yet.
		const pendingCapitalCash = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'pendingCapitalCash', args: [fixture.capitalLedger] })
		const pendingBurnCash = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'pendingBurnCash', args: [base.genesisUniverse] })
		expect(after.services).toBe(premiumTotal + pendingCapitalCash + pendingBurnCash - pendingSettlementFees)
		// A later payout drains assigned fee escrow without consuming sealed trader cash.
		await base.mockWindow.advanceTime(30n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'claimEarnings' }))
		expect(await cash(engine)).toBe(totals[0])
		expect(await cash(fixture.portfolio)).toBe(0n)
		const outstandingLater = await owner.readContract({ ...streams, functionName: 'fundedOutstanding' })
		// Vesting purchase fees are fully released (credited or burned) once their duration has passed.
		expect(outstandingLater[0]).toBe(0n)
	})
})
