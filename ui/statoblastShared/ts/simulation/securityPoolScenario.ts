import { DEFAULT_SIMULATION_REP_PER_ETH_PRICE, DEFAULT_SIMULATION_USDC_PER_REP_PRICE } from '@zoltar/ui-core-shared/simulation/repPrices.js'
import { securityPoolCollateral, type CollateralSymbol } from '../protocol/collateral.js'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { buildSecurityPoolPrepareNextRequest, buildSecurityPoolCapitalDepositRequest, buildSecurityPoolCapitalSetHealthRequest, buildSecurityPoolCapitalSetCommitmentRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import { createRangeProgressReporter, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact } from '../contractArtifact.js'
import { createMarket } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { securityPoolAddressFromCreationReceipt, securityPoolContractRequest, securityPoolCreationRequest, securityPoolReadClient, sendSecurityPoolTransaction } from '../protocol/securityPool.js'
import { settleSeededOracleReport, settleOracleReportIfNeeded, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'
import { securityPoolAdmissionCreationRequest } from '../protocol/securityPoolAdmission.js'
import { prepareSeededSecurityPoolMint } from './securityPoolScenarioMint.js'

/** Seeds real security pool contracts on the browser-local chain, with no production RPC writes. */
export async function seedSecurityPoolScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters, questionCount = 2, collateralSymbol: CollateralSymbol = 'WETH') {
	const collateral = securityPoolCollateral(profile, collateralSymbol)
	if (collateral.address === undefined) throw new Error('Simulation collateral is unavailable.')
	const collateralUnit = 10n ** BigInt(collateral.decimals)
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.98, end: 0.99 }, 20)
	await reportStep('Preparing shared security pool')
	const owner = requireQaAccount(accounts[0], 'Expected security pool simulation owner')
	const client = createWriteClient(owner)
	const readClient = createReadClient()
	const timestamp = await getSimulationChainTimestamp(memoryClient)
	const pools: Array<{ questionId: string }> = []
	for (let index = 0; index < questionCount; index++) {
		const market = await createMarket(client, {
			marketType: 'binary',
			outcomeLabels: ['Yes', 'No'],
			questionData: { answerUnit: '', description: '', displayValueMax: 0n, displayValueMin: 0n, endTime: timestamp + 365n * 86400n, numTicks: 0n, startTime: 0n, title: `Will this resolve? (security pool question ${index + 1})` },
		})
		pools.push({ questionId: market.questionId })
	}
	if (pools.length === 0) throw new Error('A simulation security pool needs a question')
	const admission = await sendSecurityPoolTransaction(client, securityPoolAdmissionCreationRequest(owner, 'open', 0n, []), 'Deploy admission policy')
	const policy = admission.receipt.contractAddress
	if (policy === null || policy === undefined) throw new Error('Expected deployed admission policy')
	const deployment = await sendSecurityPoolTransaction(
		client,
		securityPoolCreationRequest(owner, { collateralToken: collateral.address, minimumReportCollateral: collateralUnit / 100n, universeId: 0n, securityMultiplierBps: 20_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n }, 366n * 86400n, policy, {
			annualFeeBps: 1000n,
			purchaseFeeBps: 100n,
			minimumPurchaseFeeAttoEth: collateralUnit / 1000n,
			minimumCommitmentAttoEth: collateralUnit,
			minimumOutcomeRate: 10n ** 16n,
			rewardVestingSeconds: 86400n,
		}),
		'Deploy security pool',
	)
	const securityPool = securityPoolAddressFromCreationReceipt(deployment.receipt)
	const services = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'services' })
	await sendSecurityPoolTransaction(client, { account: owner, to: collateral.address, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [services, (1n << 256n) - 1n] }) }, 'Approve simulated collateral')

	await reportStep('Deployed shared security pool')
	for (let stage = 1; stage <= 4; stage++) {
		await sendSecurityPoolTransaction(client, buildSecurityPoolPrepareNextRequest({ caller: owner, securityPool }), 'Prepare security pool modules')
		await reportStep(`Prepared security pool stage ${stage} of 4`)
	}
	for (const [index, pool] of pools.entries()) {
		await sendSecurityPoolTransaction(client, securityPoolContractRequest(owner, securityPool, 'addQuestion', [BigInt(pool.questionId)]), 'Register question')
		await reportStep(`Registered security pool question ${index + 1} of ${pools.length}`)
	}
	const capitalLedger = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'capitalLedger', args: [0n] })
	const depositAttoRep = 5000n * 10n ** 18n
	await sendSecurityPoolTransaction(client, { account: owner, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [capitalLedger, depositAttoRep] }), value: 0n }, 'Approve REP for the security pool')
	await reportStep('Approved common REP deposit for the security pool')
	await sendSecurityPoolTransaction(client, buildSecurityPoolCapitalDepositRequest({ owner, capitalLedger, amountAttoRep: depositAttoRep }), 'Deposit REP into the security pool')
	await reportStep('Deposited REP into the owner’s position')
	// One settlement refreshes every question in the security pool universe.
	await advanceSimulationTime(memoryClient, 301n)
	await reportStep('Preparing shared security pool oracle')
	const commitment = 10n * collateralUnit
	const feed = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'priceFeed', args: [0n] })
	const [minimumReport, exposureDivider] = await Promise.all([readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'minimumToken1ReportAttoEth' }), readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'OPEN_INTEREST_DIVIDER' })])
	// Prepay the forthcoming commitment as well as the feed's current gas-security floor.
	const requestedInitialAttoWeth = minimumReport + ceilDiv(commitment, exposureDivider)
	const report = await settleSeededOracleReport({
		accountAddress: owner,
		createWriteClient,
		securityPool,
		onProgressStep: reportStep,
		poolLabel: 'securityPool',
		readClient,
		requestedInitialAttoWeth,
		repPerCollateralPrice: collateralSymbol === 'USDC' ? 10n ** 36n / DEFAULT_SIMULATION_USDC_PER_REP_PRICE : DEFAULT_SIMULATION_REP_PER_ETH_PRICE,
	})
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: client, ...report })
	await reportStep('Settled shared security pool oracle')
	await sendSecurityPoolTransaction(client, buildSecurityPoolCapitalSetHealthRequest({ owner, capitalLedger, targetHealthFactorBps: 12_000n }), 'Set owner health target')
	const required = await readClient.readContract({ address: capitalLedger, abi: capitalArtifact.abi, functionName: 'requiredRep', args: [commitment, 12_000n] })
	if (required > depositAttoRep) throw new Error('Seeded capital cannot cover the intended commitment')
	await sendSecurityPoolTransaction(client, buildSecurityPoolCapitalSetCommitmentRequest({ owner, capitalLedger, commitment }), 'Authorize shared commitment')
	await reportStep('Authorized individual healthy commitment')
	for (const [index, pool] of pools.entries()) {
		const request = await prepareSeededSecurityPoolMint(securityPoolReadClient(readClient), owner, securityPool, BigInt(pool.questionId), collateralUnit)
		await sendSecurityPoolTransaction(client, request, 'Mint security pool complete sets')
		await reportStep(`Minted shared security pool question ${index + 1} of ${pools.length}`)
	}
	await reportStep('Shared security pool scenario is ready')
	return { securityPool, capitalLedger, questionIds: pools.map(pool => BigInt(pool.questionId), collateralUnit) }
}
