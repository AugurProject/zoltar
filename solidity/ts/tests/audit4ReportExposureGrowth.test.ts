import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeFunctionData, keccak256, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPool_SecurityPool as securityPoolArtifact } from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { openOracleSettle, openOracleSettleWithGasPrice, wrapWeth } from '../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

const batchAbi = parseAbi(['function requestSecurityPoolPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])

// Renewals cover live exposure. Concurrent growth can reject an exact-minimum report;
// explicit funding headroom can cover that growth without freezing other users.
describe('audit4: settlement checks live exposure before accepting a report or its operations', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })

	test('#1341 an underfunded price cannot discard bounded operations against a fresh accepted price', async () => {
		// The fixture's accepted report is funded with 100 WETH, so the accepted exposure budget has headroom.
		await fixture.prepare(1_000n * unit, 100n * unit)
		const sponsor = fixture.other()
		const griefer = fixture.owner()
		await fixture.deposit(3_000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 200n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)

		// Exactly the live-exposure minimum, with no headroom.
		const minimum = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		const acceptedLimit = await sponsor.readContract({ ...feed, functionName: 'acceptedExposureLimitAttoEth' })
		expect(acceptedLimit).toBeGreaterThan(100n * unit)
		expect(minimum).toBe(unit / 100n + unit)
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		const operations = [{ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [unit, sponsor.account.address] }) }]
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, minimum, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 2_000n, operations }], value: bounty }))
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
		// Rejection preserves the accepted price; signed operations use that independently challenged price.
		expect(await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })).toBe(lastSettlementBefore)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).freeAttoRep).toBe(2_999n * unit)
		const attempts = receipt.logs
			.filter(log => log.address.toLowerCase() === address.toLowerCase() && log.topics[0] === keccak256('ReportOperationAttempted(uint256,address,uint256,bool)'))
			.map(log => decodeEventLog({ abi: feedArtifact.abi, topics: log.topics, data: log.data }))
			.map(event => (event.eventName === 'ReportOperationAttempted' ? event.args.success : undefined))
		expect(attempts).toEqual([true])
	})

	test('canonical-price operations keep an expired underfunded candidate recoverable at its fee cap', async () => {
		// The fixture's accepted report is funded with 100 WETH, so the accepted exposure budget has headroom.
		await fixture.prepare(1_000n * unit, 100n * unit)
		const sponsor = fixture.other()
		const griefer = fixture.owner()
		await fixture.deposit(3_000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 200n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)

		// Exactly the live-exposure minimum, with no headroom.
		const minimum = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		const acceptedLimit = await sponsor.readContract({ ...feed, functionName: 'acceptedExposureLimitAttoEth' })
		expect(acceptedLimit).toBeGreaterThan(100n * unit)
		expect(minimum).toBe(unit / 100n + unit)
		// Fund the additional 600,000 callback gas as well as ordinary settlement.
		const bounty = 2n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		const operations = [{ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [unit, sponsor.account.address] }) }]
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, minimum, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 2_000n, operations }], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })

		await writeContractAndWait(griefer, () => griefer.writeContract({ ...capital(), functionName: 'setCommitment', args: [100n * unit + 1n] }))
		const [, , , ceiling] = await sponsor.readContract({ ...feed, functionName: 'reportCandidates', args: [report] })
		await fixture.base.mockWindow.advanceTime(800n)
		await wrapWeth(griefer, 2n * unit)
		await approveToken(griefer, await griefer.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(griefer, await griefer.readContract({ ...feed, functionName: 'reputationToken' }), address)
		const freshBounty = await griefer.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(griefer, () => griefer.writeContract({ ...feed, functionName: 'requestSecurityPoolPrice', args: [unit, 2n * unit, freshBounty], value: freshBounty }))
		const fresh = await griefer.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(griefer, fresh)
		const spike = ceiling + 1n
		await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${spike.toString(16)}`] })
		await openOracleSettleWithGasPrice(griefer, report, spike)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(0n)
		await expect(sponsor.simulateContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: spike })).rejects.toThrow('Base fee too high')
		await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${ceiling.toString(16)}`] })
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: ceiling, gas: 5_000_000n }))
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(2n)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).freeAttoRep).toBe(2_999n * unit)
	})

	test('control: one attoETH of extra report funding survives the same bump', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		const sponsor = fixture.other()
		const griefer = fixture.owner()
		await fixture.deposit(3_000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 200n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)
		const minimum = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...feed, functionName: 'requestSecurityPoolPrice', args: [unit, minimum + 1n, bounty], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await writeContractAndWait(griefer, () => griefer.writeContract({ ...capital(), functionName: 'setCommitment', args: [100n * unit + 1n] }))
		await fixture.base.mockWindow.advanceTime(481n)
		const receipt = await sponsor.waitForTransactionReceipt({ hash: await openOracleSettle(griefer, report) })
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		// Gas the whole settlement used, for comparison with the 4,000,000 the feed reserves for acceptance.
		expect(receipt.gasUsed).toBeLessThan(1_500_000n)
	})
})
