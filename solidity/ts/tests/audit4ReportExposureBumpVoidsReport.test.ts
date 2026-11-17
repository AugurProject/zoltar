import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeFunctionData, keccak256, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { openOracleSettle, wrapWeth } from '../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const batchAbi = parseAbi(['function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])

// Audit 4 (report path): a report is judged against the aggregate exposure at SETTLEMENT, so a report
// funded with the exact minimum for the exposure at REQUEST is fragile. The client quote therefore adds
// headroom by default (quotePortfolioPriceFunding); this pins the on-chain behaviour that makes it necessary.
// Whenever the accepted exposure budget
// has headroom (any earlier oversized report), a third party can raise its own commitment by one attoETH
// during the challenge period: the pending report is then rejected as uneconomic, its price is discarded
// and its queued sponsor operations are silently dropped.
describe('audit4: a one-attoETH exposure bump voids a pending exact-minimum report and its operations', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })

	test('pending minimum-size batch report is rejected after a third party raises commitment by 1 attoETH', async () => {
		// The fixture's accepted report is funded with 100 WETH, so the accepted exposure budget has headroom.
		await fixture.prepare(1_000n * unit, 100n * unit)
		const sponsor = fixture.other()
		const griefer = fixture.owner()
		await fixture.deposit(3_000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 10n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)

		// Exactly the feed's minimum for the current exposure, with no headroom.
		const minimum = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		expect(minimum).toBe(unit / 100n + unit)
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		const timestamp = (await sponsor.getBlock()).timestamp
		const operations = [{ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [unit, sponsor.account.address] }) }]
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address, functionName: 'requestPortfolioPriceWithOperations', args: [unit, minimum, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 2_000n, operations }], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		const lastSettlementBefore = await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })

		// Griefing step: one attoETH more commitment, collateralised by spare REP the griefer already holds.
		await writeContractAndWait(griefer, () => griefer.writeContract({ ...capital(), functionName: 'setCommitment', args: [100n * unit + 1n] }))

		await fixture.base.mockWindow.advanceTime(481n)
		const receipt = await sponsor.waitForTransactionReceipt({ hash: await openOracleSettle(griefer, report) })
		const rejectedTopic = keccak256('PriceReportRejected(uint256,string,uint256,uint256,uint256,uint256)')
		const reasons = receipt.logs
			.filter(log => log.address.toLowerCase() === address.toLowerCase() && log.topics[0] === rejectedTopic)
			.map(log => {
				const event = decodeEventLog({ abi: feedArtifact.abi, topics: log.topics, data: log.data })
				if (event.eventName !== 'PriceReportRejected') throw new Error('Unexpected feed event')
				return event.args.reason
			})
		expect(reasons).toEqual(['Report uneconomic'])
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(2n)
		// The honest observation is discarded and the queued operation never ran.
		expect(await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })).toBe(lastSettlementBefore)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).freeAttoRep).toBe(3_000n * unit)
		const attemptTopic = keccak256('ReportOperationAttempted(uint256,address,uint256,bool)')
		expect(receipt.logs.filter(log => log.topics[0] === attemptTopic)).toHaveLength(0)
	})

	test('control: one attoETH of extra report funding survives the same bump', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		const sponsor = fixture.other()
		const griefer = fixture.owner()
		await fixture.deposit(3_000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 10n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)
		const minimum = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...feed, functionName: 'requestPortfolioPrice', args: [unit, minimum + 1n, bounty], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await writeContractAndWait(griefer, () => griefer.writeContract({ ...capital(), functionName: 'setCommitment', args: [100n * unit + 1n] }))
		await fixture.base.mockWindow.advanceTime(481n)
		const receipt = await sponsor.waitForTransactionReceipt({ hash: await openOracleSettle(griefer, report) })
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		// Gas the whole settlement used, for comparison with the 4,000,000 the feed reserves for acceptance.
		expect(receipt.gasUsed).toBeLessThan(1_500_000n)
	})
})
