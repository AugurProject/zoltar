import { portfolioCollateral, type CollateralSymbol } from '../protocol/collateral.js'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { buildPortfolioPrepareNextRequest, buildPortfolioCapitalDepositRequest, buildPortfolioCapitalSetHealthRequest, buildPortfolioCapitalSetCommitmentRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import { createRangeProgressReporter, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact } from '../contractArtifact.js'
import { createMarket } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { loadAllSecurityPools } from '../protocol/securityPools.js'
import { portfolioContractRequest, portfolioCreationRequest, portfolioReadClient, sendPortfolioTransaction } from '../protocol/securityPoolPortfolio.js'
import { settleSeededOracleReport, settleOracleReportIfNeeded, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'
import { portfolioAdmissionCreationRequest } from '../protocol/securityPoolPortfolioAdmission.js'
import { prepareSeededPortfolioMint } from './portfolioScenarioMint.js'

/** Seeds real portfolio contracts on the browser-local chain, with no production RPC writes. */
export async function seedPortfolioScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters, questionCount = 2, collateralSymbol: CollateralSymbol = 'WETH') {
	const collateral = portfolioCollateral(profile, collateralSymbol)
	if (collateral.address === undefined) throw new Error('Simulation collateral is unavailable.')
	const collateralUnit = 10n ** BigInt(collateral.decimals)
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.98, end: 0.99 }, 20)
	await reportStep('Preparing shared portfolio')
	const owner = requireQaAccount(accounts[0], 'Expected portfolio simulation owner')
	const client = createWriteClient(owner)
	const readClient = createReadClient()
	const timestamp = await getSimulationChainTimestamp(memoryClient)
	const pools: Array<{ questionId: string }> = []
	for (let index = 0; index < questionCount; index++) {
		const market = await createMarket(client, {
			marketType: 'binary',
			outcomeLabels: ['Yes', 'No'],
			questionData: { answerUnit: '', description: '', displayValueMax: 0n, displayValueMin: 0n, endTime: timestamp + 365n * 86400n, numTicks: 0n, startTime: 0n, title: `Will this resolve? (portfolio question ${index + 1})` },
		})
		pools.push({ questionId: market.questionId })
	}
	const initial = pools[0]
	if (initial === undefined) throw new Error('A simulation portfolio needs a question')
	const admission = await sendPortfolioTransaction(client, portfolioAdmissionCreationRequest(owner, 'open', 0n, []), 'Deploy admission policy')
	const policy = admission.receipt.contractAddress
	if (policy === null || policy === undefined) throw new Error('Expected deployed admission policy')
	const deployment = await sendPortfolioTransaction(
		client,
		portfolioCreationRequest(owner, { collateralToken: collateral.address, minimumReportCollateral: collateralUnit / 100n, universeId: 0n, securityMultiplierBps: 20_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n }, 366n * 86400n, policy, {
			annualFeeBps: 1000n,
			purchaseFeeBps: 100n,
			minimumPurchaseFeeAttoEth: collateralUnit / 1000n,
			minimumCommitmentAttoEth: collateralUnit,
			minimumOutcomeRate: 10n ** 16n,
			rewardVestingSeconds: 86400n,
		}),
		'Deploy portfolio',
	)
	const portfolio = deployment.receipt.contractAddress
	if (portfolio === null || portfolio === undefined) throw new Error('Expected deployed portfolio address')
	const services = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'services' })
	await sendPortfolioTransaction(client, { account: owner, to: collateral.address, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [services, (1n << 256n) - 1n] }) }, 'Approve simulated collateral')

	await reportStep('Deployed shared portfolio')
	for (let stage = 1; stage <= 4; stage++) {
		await sendPortfolioTransaction(client, buildPortfolioPrepareNextRequest({ caller: owner, portfolio }), 'Prepare portfolio modules')
		await reportStep(`Prepared portfolio stage ${stage} of 4`)
	}
	for (const [index, pool] of pools.entries()) {
		await sendPortfolioTransaction(client, portfolioContractRequest(owner, portfolio, 'addQuestion', [BigInt(pool.questionId)]), 'Register question')
		await reportStep(`Registered portfolio question ${index + 1} of ${pools.length}`)
	}
	const capitalLedger = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'capitalLedger', args: [0n] })
	const depositAttoRep = 5000n * 10n ** 18n
	await sendPortfolioTransaction(client, { account: owner, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [capitalLedger, depositAttoRep] }), value: 0n }, 'Approve portfolio REP')
	await reportStep('Approved common portfolio REP deposit')
	await sendPortfolioTransaction(client, buildPortfolioCapitalDepositRequest({ owner, capitalLedger, amountAttoRep: depositAttoRep }), 'Deposit portfolio REP')
	await reportStep('Funded owner principal')
	// One settlement refreshes every question in the portfolio universe.
	await advanceSimulationTime(memoryClient, 301n)
	const questionPool = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [BigInt(initial.questionId), 0n] })
	const managerAddress = (await loadAllSecurityPools(readClient)).find(pool => pool.securityPoolAddress.toLowerCase() === questionPool.toLowerCase())?.managerAddress
	if (managerAddress === undefined) throw new Error('Expected namespaced portfolio question pool')
	await reportStep('Preparing shared portfolio oracle')
	const commitment = 10n * collateralUnit
	const feed = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'priceFeed', args: [0n] })
	const [minimumReport, exposureDivider] = await Promise.all([readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'minimumToken1ReportAttoEth' }), readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'OPEN_INTEREST_DIVIDER' })])
	// Prepay the forthcoming commitment as well as the feed's current gas-security floor.
	const requestedInitialAttoWeth = minimumReport + ceilDiv(commitment, exposureDivider)
	const report = await settleSeededOracleReport({ accountAddress: owner, createWriteClient, portfolio, onProgressStep: reportStep, poolLabel: 'portfolio', readClient, requestedInitialAttoWeth })
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: client, ...report })
	await reportStep('Settled shared portfolio oracle')
	await sendPortfolioTransaction(client, buildPortfolioCapitalSetHealthRequest({ owner, capitalLedger, targetHealthFactorBps: 12_000n }), 'Set owner health target')
	const required = await readClient.readContract({ address: capitalLedger, abi: capitalArtifact.abi, functionName: 'requiredRep', args: [commitment, 12_000n] })
	if (required > depositAttoRep) throw new Error('Seeded capital cannot cover the intended commitment')
	await sendPortfolioTransaction(client, buildPortfolioCapitalSetCommitmentRequest({ owner, capitalLedger, commitment }), 'Authorize shared commitment')
	await reportStep('Authorized individual healthy commitment')
	for (const [index, pool] of pools.entries()) {
		const request = await prepareSeededPortfolioMint(portfolioReadClient(readClient), owner, portfolio, BigInt(pool.questionId), collateralUnit)
		await sendPortfolioTransaction(client, request, 'Mint portfolio complete sets')
		await reportStep(`Minted shared portfolio question ${index + 1} of ${pools.length}`)
	}
	await reportStep('Shared portfolio scenario is ready')
	return { portfolio, capitalLedger, managerAddress, questionIds: pools.map(pool => BigInt(pool.questionId), collateralUnit) }
}
