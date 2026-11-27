import { poolSetup } from '../copy/simulation.js'
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
	if (collateral.address === undefined) throw new Error(poolSetup.collateralUnavailable)
	const collateralUnit = 10n ** BigInt(collateral.decimals)
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.98, end: 0.99 }, 20)
	await reportStep(poolSetup.preparing)
	const owner = requireQaAccount(accounts[0], poolSetup.ownerMissing)
	const client = createWriteClient(owner)
	const readClient = createReadClient()
	const timestamp = await getSimulationChainTimestamp(memoryClient)
	const pools: Array<{ questionId: string }> = []
	for (let index = 0; index < questionCount; index++) {
		const market = await createMarket(client, {
			marketType: 'binary',
			outcomeLabels: ['Yes', 'No'],
			questionData: { answerUnit: '', description: '', displayValueMax: 0n, displayValueMin: 0n, endTime: timestamp + 365n * 86400n, numTicks: 0n, startTime: 0n, title: poolSetup.questionTitle(index + 1) },
		})
		pools.push({ questionId: market.questionId })
	}
	if (pools.length === 0) throw new Error(poolSetup.questionMissing)
	const admission = await sendSecurityPoolTransaction(client, securityPoolAdmissionCreationRequest(owner, 'open', 0n, []), poolSetup.prepareRules)
	const policy = admission.receipt.contractAddress
	if (policy === null || policy === undefined) throw new Error(poolSetup.rulesMissing)
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
		poolSetup.deploy,
	)
	const securityPool = securityPoolAddressFromCreationReceipt(deployment.receipt)
	const services = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'services' })
	await sendSecurityPoolTransaction(client, { account: owner, to: collateral.address, value: 0n, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [services, (1n << 256n) - 1n] }) }, poolSetup.approveCollateral)

	await reportStep(poolSetup.deployed)
	for (let stage = 1; stage <= 4; stage++) {
		await sendSecurityPoolTransaction(client, buildSecurityPoolPrepareNextRequest({ caller: owner, securityPool }), poolSetup.prepareContracts)
		await reportStep(poolSetup.preparedStage(stage))
	}
	for (const [index, pool] of pools.entries()) {
		await sendSecurityPoolTransaction(client, securityPoolContractRequest(owner, securityPool, 'addQuestion', [BigInt(pool.questionId)]), poolSetup.registerQuestion)
		await reportStep(poolSetup.registeredQuestion(index + 1, pools.length))
	}
	const capitalLedger = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'capitalLedger', args: [0n] })
	const depositAttoRep = 5000n * 10n ** 18n
	await sendSecurityPoolTransaction(client, { account: owner, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [capitalLedger, depositAttoRep] }), value: 0n }, poolSetup.approveRep)
	await reportStep(poolSetup.repApproved)
	await sendSecurityPoolTransaction(client, buildSecurityPoolCapitalDepositRequest({ owner, capitalLedger, amountAttoRep: depositAttoRep }), poolSetup.depositRep)
	await reportStep(poolSetup.repDeposited)
	// One settlement refreshes every question in the security pool universe.
	await advanceSimulationTime(memoryClient, 301n)
	await reportStep(poolSetup.preparingPrice)
	const commitment = 10n * collateralUnit
	const feed = await readClient.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'priceFeed', args: [0n] })
	const [minimumReport, exposureDivider] = await Promise.all([readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'minimumToken1ReportAttoEth' }), readClient.readContract({ address: feed, abi: feedArtifact.abi, functionName: 'OPEN_INTEREST_DIVIDER' })])
	// Prepay the forthcoming commitment as well as the feed's current gas-security floor.
	const minimumInitialAttoWeth = minimumReport + ceilDiv(commitment, exposureDivider)
	const report = await settleSeededOracleReport({
		accountAddress: owner,
		createWriteClient,
		securityPool,
		onProgressStep: reportStep,
		poolLabel: 'securityPool',
		readClient,
		minimumInitialAttoWeth,
		repPerCollateralPrice: collateralSymbol === 'USDC' ? 10n ** 36n / DEFAULT_SIMULATION_USDC_PER_REP_PRICE : DEFAULT_SIMULATION_REP_PER_ETH_PRICE,
	})
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: client, ...report })
	await reportStep(poolSetup.priceAccepted)
	await sendSecurityPoolTransaction(client, buildSecurityPoolCapitalSetHealthRequest({ owner, capitalLedger, targetHealthFactorBps: 12_000n }), poolSetup.setHealthTarget)
	const required = await readClient.readContract({ address: capitalLedger, abi: capitalArtifact.abi, functionName: 'requiredRep', args: [commitment, 12_000n] })
	if (required > depositAttoRep) throw new Error(poolSetup.insufficientBacking)
	await sendSecurityPoolTransaction(client, buildSecurityPoolCapitalSetCommitmentRequest({ owner, capitalLedger, commitment }), poolSetup.authorizeCommitment)
	await reportStep(poolSetup.commitmentAuthorized)
	for (const [index, pool] of pools.entries()) {
		const request = await prepareSeededSecurityPoolMint(securityPoolReadClient(readClient), owner, securityPool, BigInt(pool.questionId), collateralUnit)
		await sendSecurityPoolTransaction(client, request, poolSetup.mintSets)
		await reportStep(poolSetup.mintedQuestion(index + 1, pools.length))
	}
	await reportStep(poolSetup.ready)
	return { securityPool, capitalLedger, questionIds: pools.map(pool => BigInt(pool.questionId), collateralUnit) }
}
