import { describe, expect, test } from 'bun:test'
import { useSecurityPoolPortfolioFixture, unit } from './securityPoolPortfolioFixture'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as engineArtifact, statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact } from '../../types/contractArtifact'

describe('Statoblast: funded portfolio time-fee horizon', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 10_000n })
	test('long questions cap their fee duration at their own remaining funding', async () => {
		await fixture.prepare()
		await fixture.mint(unit, fixture.secondQuestionId)
		const client = fixture.owner()
		const engine = await client.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const book = await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const [question] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.secondQuestionId] })
		const [, , , timestamp] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] })
		expect(question.feeRateAttoEthPerSecond).toBeGreaterThan(0n)
		expect(BigInt(question.feeEnd) - BigInt(timestamp)).toBe(question.units / question.feeRateAttoEthPerSecond)
		expect(BigInt(question.feeEnd)).toBeLessThan(fixture.secondEndTime)
		expect(question.feeRateAttoEthPerSecond * (BigInt(question.feeEnd) - BigInt(timestamp))).toBeLessThanOrEqual(question.units)
	})
})
