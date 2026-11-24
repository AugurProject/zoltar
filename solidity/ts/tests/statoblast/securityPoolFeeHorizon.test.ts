import { describe, expect, test } from 'bun:test'
import { useSecurityPoolFixture, unit, securityPoolEconomics } from './securityPoolFixture'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_SecurityPoolSettlement_SecurityPoolSettlement as engineArtifact, statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact } from '../../types/contractArtifact'

describe('Statoblast: funded security pool time-fee horizon', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 10_000n })
	test('long questions cap their fee duration at their funding above the backing floor', async () => {
		await fixture.prepare()
		await fixture.mint(unit, fixture.secondQuestionId)
		const client = fixture.owner()
		const engine = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const [question] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.secondQuestionId] })
		const [, , , timestamp] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] })
		const reserve = (question.outcomeSupplyAttoShares * securityPoolEconomics.minimumOutcomeRate + unit - 1n) / unit
		const budget = question.units - reserve
		expect(question.feeRateAttoEthPerSecond).toBeGreaterThan(0n)
		// The budget-limited end rounds down to the book's fee-end granularity.
		const granularity = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'feeEndGranularity' })
		const unroundedEnd = BigInt(timestamp) + (budget * 1_000_000_000n) / question.feeRateAttoEthPerSecond
		expect(BigInt(question.feeEnd)).toBe(unroundedEnd - (unroundedEnd % granularity))
		expect(BigInt(question.feeEnd)).toBeLessThan(fixture.secondEndTime)
		expect(question.feeRateAttoEthPerSecond * (BigInt(question.feeEnd) - BigInt(timestamp))).toBeLessThanOrEqual(budget * 1_000_000_000n)
	})
})
