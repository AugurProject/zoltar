import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioAuctionBidRequest,
	buildPortfolioAuctionOpenRequest,
	buildPortfolioCapitalSetCommitmentRequest,
	buildPortfolioCapitalDepositRequest,
	buildPortfolioCapitalSetHealthRequest,
	buildPortfolioForkChoiceRequest,
	buildPortfolioForkPreparationRequest,
	buildPortfolioForkStartRequest,
	buildPortfolioPriceApprovalRequest,
	buildPortfolioPricePreparationRequest,
	buildPortfolioPriceRequest,
	buildPortfolioPriceWrapRequest,
	loadPortfolioAuctionSnapshot,
	loadPortfolioForkSnapshot,
	loadPortfolioPriceSnapshot,
	quotePortfolioPriceFunding,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar as zoltarArtifact } from '@zoltar/ui-core-shared/contractArtifact.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { createRangeProgressReporter, mintSimulationGenesisRep, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses } from '../protocol/deploymentHelpers.js'
import { FORK_MIGRATION_DURATION_SECONDS } from '../protocol/forkMigrationTiming.js'
import { portfolioReadClient, sendPortfolioTransaction as sendUnlabelled, type PortfolioTransaction } from '../protocol/securityPoolPortfolio.js'
import { seedPortfolioScenario } from './portfolioScenario.js'
import { prepareSeededPortfolioMint } from './portfolioScenarioMint.js'
import { DAY_IN_SECONDS, settleOracleReportIfNeeded, settleSeededOracleReport, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'

const unit = 10n ** 18n
const FORK_OUTCOME = 1n

/** Seeding failures name the step, since the simulation worker only relays the revert reason. */
async function sendPortfolioTransaction(client: Parameters<typeof sendUnlabelled>[0], request: PortfolioTransaction, title: string) {
	try {
		return await sendUnlabelled(client, request, title)
	} catch (error) {
		let detail = error instanceof Error ? error.message : String(error)
		// A mined revert carries no reason; replay the call to recover it.
		try {
			await client.call({ account: client.account, to: request.to, data: request.data, value: request.value })
		} catch (replay) {
			detail += ` (replay: ${replay instanceof Error ? replay.message : String(replay)})`
		}
		throw new Error(`${title}: ${detail}`)
	}
}

/**
 * Seeds the shared portfolio, forks it on its first question and opens the Yes
 * branch truth auction with the owner's winning bid, the owner's excluded bid and
 * a rival's tied bids, so refunds, activation and vault controls are all reachable.
 */
export async function seedPortfolioAuctionScenario(parameters: ScenarioSeedParameters) {
	const seeded = await seedPortfolioScenario(parameters)
	const { accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile } = parameters
	// Every step reports progress: the browser worker restarts its request timeout on each report.
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.99, end: 0.999 }, 35)
	const owner = requireQaAccount(accounts[0], 'Expected portfolio auction simulation owner')
	const rival = requireQaAccount(accounts[1], 'Expected portfolio auction simulation rival bidder')
	const ownerClient = createWriteClient(owner)
	const rivalClient = createWriteClient(rival)
	const readClient = createReadClient()
	const reader = { ...portfolioReadClient(readClient), getBalance: (request: { address: Address; blockNumber: bigint }) => readClient.getBalance(request) }
	const zoltar = getInfraContractAddresses().zoltar
	const questionId = seeded.questionIds[0]
	if (questionId === undefined) throw new Error('Expected a registered portfolio question')
	const { portfolio, capitalLedger } = seeded

	// More purchased claims, within the seeded healthy commitment, leave the chosen branch an ETH shortfall of several lots.
	for (let round = 0; round < 6; round++) {
		await sendPortfolioTransaction(ownerClient, await prepareSeededPortfolioMint(reader, owner, portfolio, questionId, unit, 1_000n), 'Mint portfolio complete sets')
		await reportStep(`Minted claim ${round + 1} of 6 the branch must repair`)
	}

	// A larger challenged report budget admits a second underwriter's commitment once the seeded price expires.
	const feed = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'priceFeed', args: [0n] })
	const [minimumReport, exposureDivider, validUntil] = await Promise.all([
		readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'minimumToken1ReportAttoEth' }),
		readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'OPEN_INTEREST_DIVIDER' }),
		readClient.readContract({ address: capitalLedger, abi: capitalArtifact.abi, functionName: 'priceValidUntil' }),
	])
	const now = await getSimulationChainTimestamp(memoryClient)
	if (BigInt(validUntil) >= now) await advanceSimulationTime(memoryClient, BigInt(validUntil) - now + 1n)
	const report = await settleSeededOracleReport({ accountAddress: owner, createWriteClient, portfolio, onProgressStep: reportStep, poolLabel: 'portfolio auction', readClient, requestedInitialAttoWeth: minimumReport + ceilDiv(4n * 10n * unit, exposureDivider) })
	await reportStep('Requested a larger shared price report')
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: ownerClient, ...report })
	await reportStep('Challenged a larger shared price report')

	// Unchosen backing becomes the branch auction's REP inventory.
	const rivalRep = 5_000n * unit
	await sendPortfolioTransaction(rivalClient, { account: rival, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [capitalLedger, rivalRep] }), value: 0n }, 'Approve rival REP')
	await sendPortfolioTransaction(rivalClient, buildPortfolioCapitalDepositRequest({ owner: rival, capitalLedger, amountAttoRep: rivalRep }), 'Deposit rival REP')
	await reportStep("Deposited the second underwriter's REP")
	await sendPortfolioTransaction(rivalClient, buildPortfolioCapitalSetHealthRequest({ owner: rival, capitalLedger, targetHealthFactorBps: 12_000n }), 'Set rival health target')
	await sendPortfolioTransaction(rivalClient, buildPortfolioCapitalSetCommitmentRequest({ owner: rival, capitalLedger, commitment: 10n * unit }), 'Authorize rival commitment')
	await reportStep('Funded a second underwriter whose backing stays unchosen')

	// Forcing a fork burns the threshold from the caller; the fixture mints it to the owner first.
	const threshold = await readClient.readContract({ address: zoltar, abi: zoltarArtifact.abi, functionName: 'getForkThresholdAttoRep', args: [0n] })
	await mintSimulationGenesisRep({ accountAddress: owner, amount: threshold + 1_000n * unit, createWriteClient, memoryClient, repAddress: profile.genesisRepTokenAddress, zoltarAddress: zoltar })
	// The fixture mint raises the theoretical supply, and with it the threshold Zoltar pulls at fork time.
	const forkBalance = await readClient.readContract({ address: profile.genesisRepTokenAddress, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] })
	await sendPortfolioTransaction(ownerClient, { account: owner, to: profile.genesisRepTokenAddress, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [zoltar, forkBalance] }) }, 'Approve fork REP')
	await reportStep('Funded the fork threshold')
	await advanceSimulationTime(memoryClient, 365n * DAY_IN_SECONDS + 60n)
	await reportStep('Ended the first question')
	await sendPortfolioTransaction(ownerClient, { account: owner, to: zoltar, value: 0n, data: encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'forkUniverse', args: [0n, questionId] }) }, 'Fork the origin universe')
	await reportStep('Forked the origin universe on the first question')
	const controller = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'forkController' })
	await sendPortfolioTransaction(ownerClient, { ...buildPortfolioForkPreparationRequest({ owner, controller, universeId: 0n, outcomeIndex: FORK_OUTCOME }), gas: 16_777_216n }, 'Prepare the Yes branch capital')
	await reportStep('Prepared the Yes branch capital')
	await sendPortfolioTransaction(ownerClient, { ...buildPortfolioForkChoiceRequest({ owner, controller, universeId: 0n, outcomeIndex: FORK_OUTCOME }), gas: 16_777_216n }, 'Choose the Yes branch')
	await reportStep('Owner chose the Yes branch')
	await advanceSimulationTime(memoryClient, FORK_MIGRATION_DURATION_SECONDS + 60n)
	await reportStep('Closed the branch choice window')
	await sendPortfolioTransaction(ownerClient, buildPortfolioForkStartRequest({ owner, controller, universeId: 0n, outcomeIndex: FORK_OUTCOME }), 'Start the Yes branch')
	const fork = await loadPortfolioForkSnapshot({ client: reader, portfolio, owner, universeId: 0n, outcomeIndex: FORK_OUTCOME })
	const child = fork.branch?.universeId
	if (child === undefined) throw new Error('Expected the started Yes branch')
	await reportStep('Started the Yes branch')

	await sendPortfolioTransaction(ownerClient, buildPortfolioPricePreparationRequest(await loadPortfolioPriceSnapshot({ client: reader, portfolio, owner, universeId: child })), 'Prepare the branch price feed')
	await reportStep('Prepared the branch price feed')
	let price = await loadPortfolioPriceSnapshot({ client: reader, portfolio, owner, universeId: child })
	const funding = quotePortfolioPriceFunding(price, unit)
	// The fork credited the owner's migration balance; mint branch REP from it for the report.
	await sendPortfolioTransaction(ownerClient, { account: owner, to: zoltar, value: 0n, data: encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'prepareAndSplitMigrationRep', args: [0n, 2n * funding.rep, [FORK_OUTCOME], 0n] }) }, 'Mint branch REP')
	await reportStep('Minted branch REP for the report')
	if (funding.wrap > 0n) await sendPortfolioTransaction(ownerClient, buildPortfolioPriceWrapRequest(price, funding.wrap), 'Wrap report ETH')
	await sendPortfolioTransaction(ownerClient, buildPortfolioPriceApprovalRequest(price, 'weth', funding.weth), 'Approve report WETH')
	await reportStep('Approved report WETH')
	await sendPortfolioTransaction(ownerClient, buildPortfolioPriceApprovalRequest(price, 'rep', funding.rep), 'Approve report REP')
	await reportStep('Approved report REP')
	price = await loadPortfolioPriceSnapshot({ client: reader, portfolio, owner, universeId: child })
	await sendPortfolioTransaction(ownerClient, buildPortfolioPriceRequest(price, unit), 'Report the branch price')
	await reportStep('Reported the branch REP price')
	price = await loadPortfolioPriceSnapshot({ client: reader, portfolio, owner, universeId: child })
	if (price.observation === undefined || price.observation.pendingReportId === 0n) throw new Error('Expected a pending branch price report')
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: ownerClient, openOracleAddress: price.observation.openOracle, pendingReportId: price.observation.pendingReportId })
	await reportStep('Settled the branch REP price')

	const auctionFor = (bidder: Address) => loadPortfolioAuctionSnapshot({ client: reader, portfolio, bidder, universeId: child })
	await sendPortfolioTransaction(ownerClient, buildPortfolioAuctionOpenRequest(await auctionFor(owner)), 'Open the branch truth auction')
	await reportStep('Opened the branch truth auction')
	let snapshot = await auctionFor(owner)
	const auction = snapshot.auction
	if (auction === undefined) throw new Error('Expected the opened branch truth auction')
	const minimum = auction.minimumCollateralAttoRepPerLot
	await sendPortfolioTransaction(ownerClient, buildPortfolioAuctionBidRequest(snapshot, { lots: 2n, minimumAttoRepPerLot: minimum, targetHealthFactorBps: 10_000n }), 'Submit the winning bid')
	await reportStep('Owner placed the winning bid')
	snapshot = await auctionFor(owner)
	await sendPortfolioTransaction(ownerClient, buildPortfolioAuctionBidRequest(snapshot, { lots: 1n, minimumAttoRepPerLot: 50n * minimum, targetHealthFactorBps: 10_000n }), 'Submit the bid that better demand excludes')
	await reportStep('Owner placed a winning and an expensive bid')
	await sendPortfolioTransaction(rivalClient, buildPortfolioAuctionBidRequest(await auctionFor(rival), { lots: auction.targetLots, minimumAttoRepPerLot: minimum, targetHealthFactorBps: 10_000n }), 'Submit rival tied bids')
	const final = await auctionFor(owner)
	const excluded = final.auction?.bids.find(bid => bid.minimumAttoRepPerLot === 50n * minimum)
	if (excluded === undefined || excluded.earlyRefundAttoEth === 0n) throw new Error('Expected the expensive owner bid to be refundable before closing')
	await reportStep('Seeded portfolio-auction scenario is ready')
}
