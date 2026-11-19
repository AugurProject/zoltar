import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeFunctionData, keccak256, parseAbi, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_openOracle_OpenOracle_OpenOracle as oracleArtifact,
	statoblast_SharedPoolReportEscrow_SharedPoolReportEscrow as escrowArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { openOracleSettleWithGasPrice, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const batchAbi = parseAbi(['function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])
const attoEthPerNanoEth = 10n ** 9n
const REPORT_PENDING = 0n
const REPORT_ACCEPTED = 1n
const REPORT_REJECTED = 2n

type Log = { address: string; topics: readonly Hex[]; data: Hex }
const feedTopics = new Set([keccak256('PriceReportRejected(uint256,string,uint256,uint256,uint256,uint256)'), keccak256('PriceReportDeferred(uint256,uint256,uint256)'), keccak256('PriceReported(uint256,uint256,uint256)'), keccak256('ReportOperationAttempted(uint256,address,uint256,bool)')])

const feedEvents = (logs: readonly Log[], address: string) =>
	logs
		.filter(log => log.address.toLowerCase() === address.toLowerCase() && log.topics[0] !== undefined && feedTopics.has(log.topics[0]))
		.map(log => {
			const [signature, ...rest] = log.topics
			if (signature === undefined) throw new Error('Feed log has no signature topic')
			const event = decodeEventLog({ abi: feedArtifact.abi, topics: [signature, ...rest], data: log.data })
			if (event.eventName === 'PriceReportRejected') return `PriceReportRejected(${event.args.reason})`
			if (event.eventName === 'ReportOperationAttempted') return `ReportOperationAttempted(success=${event.args.success})`
			return event.eventName
		})

// The escrow emits ReportCompleted on every settlement callback, carrying the feed's reportOutcome.
const reportCompletedOutcomes = (logs: readonly Log[], escrow: string) =>
	logs
		.filter(log => log.address.toLowerCase() === escrow.toLowerCase() && log.topics[0] === keccak256('ReportCompleted(uint256,address,uint8)'))
		.map(log => {
			const [signature, ...rest] = log.topics
			if (signature === undefined) throw new Error('Escrow log has no signature topic')
			const event = decodeEventLog({ abi: escrowArtifact.abi, topics: [signature, ...rest], data: log.data })
			if (event.eventName !== 'ReportCompleted') throw new Error(`Unexpected escrow event ${event.eventName}`)
			return { reportId: event.args.reportId, priceFeed: event.args.priceFeed, outcome: BigInt(event.args.outcome) }
		})

// Every report records maxSettlementBaseFee = 3 x (request base fee + priority fee), but anyone
// may choose the settlement block. A settlement above that ceiling must not void the report:
// it stays pending until a recovery at or below the ceiling completes it, or it goes stale.
describe('Statoblast: shared price feed defers settlements above the report base-fee ceiling', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const setNextBlockBaseFee = async (baseFee: bigint) => await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFee.toString(16)}`] })

	const sponsorReportWithWithdrawal = async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		const sponsor = fixture.other()
		const settler = fixture.owner()
		await fixture.deposit(3_000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		const weth = await sponsor.readContract({ ...feed, functionName: 'weth' })
		const reportWeth = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		await wrapWeth(sponsor, reportWeth)
		await approveToken(sponsor, weth, address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		const timestamp = (await sponsor.getBlock()).timestamp
		const operations = [{ gasLimit: 500_000, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [unit, sponsor.account.address] }) }]
		// Requested at a 1 nanoETH per gas base fee with the default 10 nanoETH per gas report priority fee: a 33 nanoETH per gas ceiling.
		await setNextBlockBaseFee(1n * attoEthPerNanoEth)
		await writeContractAndWait(sponsor, () =>
			sponsor.writeContract({ abi: batchAbi, address, functionName: 'requestPortfolioPriceWithOperations', args: [unit, reportWeth, bounty, { gasLimit: 600_000, minimumPrice: unit, maximumPrice: unit, deadline: Number(timestamp + 5_000n), operations }], value: bounty, gasPrice: 2n * attoEthPerNanoEth }),
		)
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		const [escrow, , , ceiling] = await sponsor.readContract({ ...feed, functionName: 'reportCandidates', args: [report] })
		expect(ceiling).toBe(33n * attoEthPerNanoEth)
		return { sponsor, settler, feed, weth, escrow, report, ceiling }
	}

	const settleAboveCeiling = async () => {
		const setup = await sponsorReportWithWithdrawal()
		const { sponsor, settler, feed, report, ceiling } = setup
		const lastSettlementBefore = await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })
		await fixture.base.mockWindow.advanceTime(481n)
		const spike = ceiling + 1n
		await setNextBlockBaseFee(spike)
		const receipt = await settler.waitForTransactionReceipt({ hash: await openOracleSettleWithGasPrice(settler, report, spike) })
		expect(receipt.status).toBe('success')
		return { ...setup, receipt, spike, lastSettlementBefore }
	}

	const freeAttoRep = async (owner: `0x${string}`) => (await fixture.owner().readContract({ ...capital(), functionName: 'ownerAccount', args: [owner] })).freeAttoRep

	test('only a feed-accepted report can authorize commitment growth (#1360)', async () => {
		const { sponsor, settler, feed, report, ceiling } = await settleAboveCeiling()
		await setNextBlockBaseFee(ceiling)
		await fixture.base.mockWindow.request({ method: 'evm_mine', params: [] })
		const proof = { ...feed, functionName: 'reportAuthorization', args: [report, 100n * unit] } as const
		await expect(sponsor.readContract(proof)).rejects.toThrow('Report candidate not accepted')

		await setNextBlockBaseFee(ceiling)
		await writeContractAndWait(settler, () => settler.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: ceiling, gas: 5_000_000n }))
		const [price, epoch] = await sponsor.readContract(proof)
		expect(price).toBeGreaterThan(unit)
		expect(epoch).toBe(await sponsor.readContract({ ...feed, functionName: 'acceptedEpoch' }))
	})

	test('a third-party settlement one attoETH per gas above the ceiling leaves the report pending and its funding released', async () => {
		const { sponsor, feed, weth, escrow, report, receipt, spike, lastSettlementBefore } = await settleAboveCeiling()

		expect(feedEvents(receipt.logs, feed.address)).toEqual(['PriceReportDeferred'])
		// The escrow still names the feed but reports the deferral as pending, not as a final rejection.
		expect(reportCompletedOutcomes(receipt.logs, escrow)).toEqual([{ reportId: report, priceFeed: feed.address, outcome: REPORT_PENDING }])
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(REPORT_PENDING)
		expect(await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })).toBe(report)
		expect(await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })).toBe(lastSettlementBefore)
		expect(await freeAttoRep(sponsor.account.address)).toBe(3_000n * unit)
		// OpenOracle settled the game and the escrow paid the final reporter's funds out.
		const oracle = await sponsor.readContract({ ...feed, functionName: 'openOracle' })
		expect(await sponsor.readContract({ abi: oracleArtifact.abi, address: oracle, functionName: 'tokenHolder', args: [escrow, weth] })).toBeLessThanOrEqual(1n)
		const [, , , , settledAt] = await sponsor.readContract({ abi: oracleArtifact.abi, address: oracle, functionName: 'storedGame', args: [report] })
		expect(BigInt(settledAt)).toBeGreaterThan(0n)
		// Recovery cannot complete the report while the base fee is still above the ceiling.
		await setNextBlockBaseFee(spike)
		await expect(sponsor.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: spike, gas: 5_000_000n })).rejects.toThrow('Base fee too high')
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(REPORT_PENDING)
	})

	test('a settlement at the ceiling is accepted and its escrow reports the accepted outcome', async () => {
		const { sponsor, settler, feed, escrow, report, ceiling } = await sponsorReportWithWithdrawal()
		await fixture.base.mockWindow.advanceTime(481n)
		await setNextBlockBaseFee(ceiling)
		const receipt = await settler.waitForTransactionReceipt({ hash: await openOracleSettleWithGasPrice(settler, report, ceiling) })

		expect(feedEvents(receipt.logs, feed.address)).toEqual(['PriceReported', 'ReportOperationAttempted(success=true)'])
		expect(reportCompletedOutcomes(receipt.logs, escrow)).toEqual([{ reportId: report, priceFeed: feed.address, outcome: REPORT_ACCEPTED }])
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(REPORT_ACCEPTED)
	})

	test('a settlement after the validity window is rejected and its escrow reports the rejected outcome', async () => {
		const { sponsor, settler, feed, escrow, report, ceiling } = await sponsorReportWithWithdrawal()
		const oracle = await sponsor.readContract({ ...feed, functionName: 'openOracle' })
		const [, , , reportedAt, , , , settlementTime] = await sponsor.readContract({ abi: oracleArtifact.abi, address: oracle, functionName: 'storedGame', args: [report] })
		const validity = await sponsor.readContract({ ...feed, functionName: 'priceValidityWindowSeconds' })
		await fixture.base.mockWindow.setTime(BigInt(reportedAt) + BigInt(settlementTime) + validity)
		await setNextBlockBaseFee(ceiling)
		const receipt = await settler.waitForTransactionReceipt({ hash: await openOracleSettleWithGasPrice(settler, report, ceiling) })

		expect(feedEvents(receipt.logs, feed.address)).toEqual(['PriceReportRejected(Report stale)'])
		expect(reportCompletedOutcomes(receipt.logs, escrow)).toEqual([{ reportId: report, priceFeed: feed.address, outcome: REPORT_REJECTED }])
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(REPORT_REJECTED)
	})

	test('recovery at the ceiling accepts the settled price at its original timestamp and runs the sponsor operations', async () => {
		const { sponsor, settler, feed, report, ceiling } = await settleAboveCeiling()
		const oracle = await sponsor.readContract({ ...feed, functionName: 'openOracle' })
		const [, , , reportedAt, , , , settlementTime] = await sponsor.readContract({ abi: oracleArtifact.abi, address: oracle, functionName: 'storedGame', args: [report] })

		await fixture.base.mockWindow.advanceTime(12n)
		await setNextBlockBaseFee(ceiling)
		const receipt = await settler.waitForTransactionReceipt({ hash: await writeContractAndWait(settler, () => settler.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: ceiling, gas: 5_000_000n })) })

		expect(feedEvents(receipt.logs, feed.address)).toEqual(['PriceReported', 'ReportOperationAttempted(success=true)'])
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(REPORT_ACCEPTED)
		expect(await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })).toBe(0n)
		expect(await sponsor.readContract({ ...feed, functionName: 'lastPrice' })).toBe(unit)
		// Freshness runs from the settled observation, not from the later recovery block.
		expect(await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })).toBe(BigInt(reportedAt) + BigInt(settlementTime))
		expect(await freeAttoRep(sponsor.account.address)).toBe(2_999n * unit)
	})

	test('recovery after the validity window retires the deferred report as stale without running operations', async () => {
		const { sponsor, settler, feed, report, spike } = await settleAboveCeiling()
		const oracle = await sponsor.readContract({ ...feed, functionName: 'openOracle' })
		const [, , , reportedAt, , , , settlementTime] = await sponsor.readContract({ abi: oracleArtifact.abi, address: oracle, functionName: 'storedGame', args: [report] })
		const validity = await sponsor.readContract({ ...feed, functionName: 'priceValidityWindowSeconds' })
		const lastSettlementBefore = await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })

		await fixture.base.mockWindow.setTime(BigInt(reportedAt) + BigInt(settlementTime) + validity)
		// Staleness is final regardless of the base fee, so nobody has to wait for a quiet block to retire it.
		await setNextBlockBaseFee(spike)
		const receipt = await settler.waitForTransactionReceipt({ hash: await writeContractAndWait(settler, () => settler.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: spike, gas: 5_000_000n })) })

		expect(feedEvents(receipt.logs, feed.address)).toEqual(['PriceReportRejected(Report stale)'])
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(REPORT_REJECTED)
		expect(await sponsor.readContract({ ...feed, functionName: 'lastSettlementTimestamp' })).toBe(lastSettlementBefore)
		expect(await freeAttoRep(sponsor.account.address)).toBe(3_000n * unit)
		await setNextBlockBaseFee(1n * attoEthPerNanoEth)
		await expect(sponsor.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: 2n * attoEthPerNanoEth, gas: 5_000_000n })).rejects.toThrow('No report to recover')
	})
})
