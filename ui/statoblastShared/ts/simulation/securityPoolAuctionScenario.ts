import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildSecurityPoolAuctionBidRequest,
	buildSecurityPoolAuctionOpenRequest,
	buildSecurityPoolCapitalSetCommitmentRequest,
	buildSecurityPoolCapitalDepositRequest,
	buildSecurityPoolCapitalSetHealthRequest,
	buildSecurityPoolForkStartRequest,
	buildSecurityPoolPriceApprovalRequest,
	buildSecurityPoolPricePreparationRequest,
	buildSecurityPoolPriceRequest,
	buildSecurityPoolPriceWrapRequest,
	loadSecurityPoolAuctionSnapshot,
	loadSecurityPoolForkSnapshot,
	loadSecurityPoolPriceSnapshot,
	quoteSecurityPoolPriceFunding,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar as zoltarArtifact } from '@zoltar/ui-core-shared/contractArtifact.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { createRangeProgressReporter, mintSimulationGenesisRep, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses } from '../protocol/deploymentHelpers.js'
import { FORK_MIGRATION_DURATION_SECONDS } from '../protocol/forkMigrationTiming.js'
import { securityPoolReadClient, sendSecurityPoolTransaction as sendUnlabelled, type SecurityPoolTransaction } from '../protocol/securityPool.js'
import { seedSecurityPoolScenario } from './securityPoolScenario.js'
import { prepareSeededSecurityPoolMint } from './securityPoolScenarioMint.js'
import { DAY_IN_SECONDS, settleOracleReportIfNeeded, settleSeededOracleReport, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'

const unit = 10n ** 18n
const FORK_OUTCOME = 1n

/** Seeding failures name the step, since the simulation worker only relays the revert reason. */
async function sendSecurityPoolTransaction(client: Parameters<typeof sendUnlabelled>[0], request: SecurityPoolTransaction, title: string) {
	try {
		return await sendUnlabelled(client, request, title)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new Error(`${title}: ${detail}`)
	}
}

/**
 * Seeds the shared security pool, forks it on its first question and opens the Yes
 * branch collateral repair auction with the owner's winning bid, the owner's excluded bid and
 * a rival's tied bids, so refunds, activation and vault controls are all reachable.
 */
export async function seedSecurityPoolAuctionScenario(parameters: ScenarioSeedParameters) {
	const seeded = await seedSecurityPoolScenario(parameters)
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile } = parameters
	// Every step reports progress: the browser worker restarts its request timeout on each report.
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.99, end: 0.999 }, 35)
	const owner = requireQaAccount(accounts[0], 'Expected security pool auction simulation owner')
	const rival = requireQaAccount(accounts[1], 'Expected security pool auction simulation rival bidder')
	const ownerClient = createWriteClient(owner)
	const rivalClient = createWriteClient(rival)
	const readClient = createReadClient()
	const reader = { ...securityPoolReadClient(readClient), getBalance: (request: { address: Address; blockNumber: bigint }) => readClient.getBalance(request) }
	const zoltar = getInfraContractAddresses().zoltar
	const questionId = seeded.questionIds[0]
	if (questionId === undefined) throw new Error('Expected a registered security pool question')
	const { securityPool, capitalLedger } = seeded

	// More purchased claims, within the seeded healthy commitment, leave the chosen branch an ETH shortfall of several lots.
	for (let round = 0; round < 6; round++) {
		await sendSecurityPoolTransaction(ownerClient, await prepareSeededSecurityPoolMint(reader, owner, securityPool, questionId, unit, 1_000n), 'Mint security pool complete sets')
		await reportStep(`Minted claim ${round + 1} of 6 the branch must back`)
	}

	// A larger challenged report budget admits a second underwriter's commitment once the seeded price expires.
	const feed = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'priceFeed', args: [0n] })
	const [minimumReport, exposureDivider, validUntil] = await Promise.all([
		readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'minimumToken1ReportAttoEth' }),
		readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'OPEN_INTEREST_DIVIDER' }),
		readClient.readContract({ address: capitalLedger, abi: capitalArtifact.abi, functionName: 'priceValidUntil' }),
	])
	const now = await getSimulationChainTimestamp(memoryClient)
	if (BigInt(validUntil) >= now) await advanceSimulationTime(memoryClient, BigInt(validUntil) - now + 1n)
	const report = await settleSeededOracleReport({ accountAddress: owner, createWriteClient, securityPool, onProgressStep: reportStep, poolLabel: 'security pool auction', readClient, requestedInitialAttoWeth: minimumReport + ceilDiv(4n * 10n * unit, exposureDivider) })
	await reportStep('Requested a larger shared price report')
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: ownerClient, ...report })
	await reportStep('Challenged a larger shared price report')

	// Unchosen backing becomes the branch auction's REP inventory.
	const rivalRep = 5_000n * unit
	await sendSecurityPoolTransaction(rivalClient, { account: rival, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [capitalLedger, rivalRep] }), value: 0n }, 'Approve rival REP')
	await sendSecurityPoolTransaction(rivalClient, buildSecurityPoolCapitalDepositRequest({ owner: rival, capitalLedger, amountAttoRep: rivalRep }), 'Deposit rival REP')
	await reportStep("Deposited the second underwriter's REP")
	await sendSecurityPoolTransaction(rivalClient, buildSecurityPoolCapitalSetHealthRequest({ owner: rival, capitalLedger, targetHealthFactorBps: 12_000n }), 'Set rival health target')
	await sendSecurityPoolTransaction(rivalClient, buildSecurityPoolCapitalSetCommitmentRequest({ owner: rival, capitalLedger, commitment: 10n * unit }), 'Authorize rival commitment')
	await reportStep('Funded a second underwriter whose backing stays unchosen')

	// Forcing a fork burns the threshold from the caller; the fixture mints it to the owner first.
	const threshold = await readClient.readContract({ address: zoltar, abi: zoltarArtifact.abi, functionName: 'getForkThresholdAttoRep', args: [0n] })
	await mintSimulationGenesisRep({ accountAddress: owner, amount: threshold + 1_000n * unit, createWriteClient, memoryClient, repAddress: profile.genesisRepTokenAddress, zoltarAddress: zoltar })
	// The fixture mint raises the theoretical supply, and with it the threshold Zoltar pulls at fork time.
	const forkBalance = await readClient.readContract({ address: profile.genesisRepTokenAddress, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] })
	await sendSecurityPoolTransaction(ownerClient, { account: owner, to: profile.genesisRepTokenAddress, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [zoltar, forkBalance] }) }, 'Approve fork REP')
	await reportStep('Funded the fork threshold')
	await advanceSimulationTime(memoryClient, 365n * DAY_IN_SECONDS + 60n)
	await reportStep('Ended the first question')
	await sendSecurityPoolTransaction(ownerClient, { account: owner, to: zoltar, value: 0n, data: encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'forkUniverse', args: [0n, questionId] }) }, 'Fork the origin universe')
	await reportStep('Forked the origin universe on the first question')
	const controller = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'forkController' })
	// Keep both underwriters unchosen so the deficit is the exact claim total.
	// Fractional inherited cash can otherwise leave a one-lot auction, where
	// the first winning bid correctly excludes every later bid at its floor.
	await reportStep('Kept unchosen backing available for a multi-lot branch auction')
	await advanceSimulationTime(memoryClient, FORK_MIGRATION_DURATION_SECONDS + 60n)
	await reportStep('Closed the branch choice window')
	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolForkStartRequest({ owner, controller, universeId: 0n, outcomeIndex: FORK_OUTCOME }), 'Start the Yes branch')
	const fork = await loadSecurityPoolForkSnapshot({ client: reader, securityPool, owner, universeId: 0n, outcomeIndex: FORK_OUTCOME })
	const child = fork.branch?.universeId
	if (child === undefined) throw new Error('Expected the started Yes branch')
	await reportStep('Started the Yes branch')

	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolPricePreparationRequest(await loadSecurityPoolPriceSnapshot({ client: reader, securityPool, owner, universeId: child })), 'Prepare the branch price feed')
	await reportStep('Prepared the branch price feed')
	let price = await loadSecurityPoolPriceSnapshot({ client: reader, securityPool, owner, universeId: child })
	const funding = quoteSecurityPoolPriceFunding(price, unit)
	// The fork credited the owner's migration balance; mint branch REP from it for the report.
	await sendSecurityPoolTransaction(ownerClient, { account: owner, to: zoltar, value: 0n, data: encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'prepareAndSplitMigrationRep', args: [0n, 2n * funding.rep, [FORK_OUTCOME], 0n] }) }, 'Mint branch REP')
	await reportStep('Minted branch REP for the report')
	if (funding.wrap > 0n) await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolPriceWrapRequest(price, funding.wrap), 'Wrap report ETH')
	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolPriceApprovalRequest(price, 'weth', funding.weth), 'Approve report WETH')
	await reportStep('Approved report WETH')
	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolPriceApprovalRequest(price, 'rep', funding.rep), 'Approve report REP')
	await reportStep('Approved report REP')
	price = await loadSecurityPoolPriceSnapshot({ client: reader, securityPool, owner, universeId: child })
	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolPriceRequest(price, unit), 'Report the branch price')
	await reportStep('Reported the branch REP price')
	price = await loadSecurityPoolPriceSnapshot({ client: reader, securityPool, owner, universeId: child })
	if (price.observation === undefined || price.observation.pendingReportId === 0n) throw new Error('Expected a pending branch price report')
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: ownerClient, openOracleAddress: price.observation.openOracle, pendingReportId: price.observation.pendingReportId })
	await reportStep('Settled the branch REP price')

	const auctionFor = (bidder: Address) => loadSecurityPoolAuctionSnapshot({ client: reader, securityPool, bidder, universeId: child })
	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolAuctionOpenRequest(await auctionFor(owner)), 'Open the recapitalization auction')
	await reportStep('Opened the recapitalization auction')
	let snapshot = await auctionFor(owner)
	const auction = snapshot.auction
	if (auction === undefined) throw new Error('Expected the open recapitalization auction')
	if (auction.targetLots <= 2n) throw new Error('Expected room for both the owner and rival auction bids')
	const minimum = auction.minimumCollateralAttoRepPerLot
	for (const [account, client] of [
		[owner, ownerClient],
		[rival, rivalClient],
	] as const)
		await sendSecurityPoolTransaction(client, { account, to: profile.wethAddress, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [auction.address, (1n << 256n) - 1n] }) }, 'Approve simulated auction collateral')
	snapshot = await auctionFor(owner)

	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolAuctionBidRequest(snapshot, { lots: 2n, minimumAttoRepPerLot: minimum, targetHealthFactorBps: 10_000n }), 'Submit the winning bid')
	await reportStep('Owner placed the winning bid')
	snapshot = await auctionFor(owner)
	await sendSecurityPoolTransaction(ownerClient, buildSecurityPoolAuctionBidRequest(snapshot, { lots: 1n, minimumAttoRepPerLot: 50n * minimum, targetHealthFactorBps: 10_000n }), 'Submit the bid that better demand excludes')
	await reportStep('Owner placed a winning and an expensive bid')
	await sendSecurityPoolTransaction(rivalClient, buildSecurityPoolAuctionBidRequest(await auctionFor(rival), { lots: auction.targetLots, minimumAttoRepPerLot: minimum, targetHealthFactorBps: 10_000n }), 'Submit rival tied bids')
	const final = await auctionFor(owner)
	const excluded = final.auction?.bids.find(bid => bid.minimumAttoRepPerLot === 50n * minimum)
	if (excluded === undefined || excluded.earlyRefundAttoEth === 0n) throw new Error('Expected the expensive owner bid to be refundable before closing')
	await reportStep('Seeded portfolio-auction scenario is ready')
	return seeded
}
