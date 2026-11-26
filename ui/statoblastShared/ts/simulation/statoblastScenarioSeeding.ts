import { priceReport } from '../copy/simulation.js'
import { DEFAULT_SIMULATION_REP_PER_ETH_PRICE } from '@zoltar/ui-core-shared/simulation/repPrices.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolPriceApprovalRequest, buildSecurityPoolPriceRequest, buildSecurityPoolPriceWrapRequest, loadSecurityPoolPriceSnapshot, quoteSecurityPoolPriceFunding } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { BootstrapScenarioApplyParameters, TevmLikeClient } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { getStatoblastScenarioProtocol as getScenarioProtocol } from './statoblastScenarioProtocol.js'
import { securityPoolReadClient, sendSecurityPoolTransaction } from '../protocol/securityPool.js'

export const DAY_IN_SECONDS = 86400n
export type ScenarioSeedParameters = Omit<BootstrapScenarioApplyParameters, 'scenario'>

export async function settleSeededOracleReport({
	accountAddress,
	createWriteClient,
	securityPool,
	onProgressStep,
	poolLabel,
	readClient,
	requestedInitialAttoWeth = 0n,
	repPerCollateralPrice,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	securityPool: Address
	onProgressStep: (label: string) => Promise<void>
	poolLabel: string
	readClient: ReadClient
	requestedInitialAttoWeth?: bigint
	repPerCollateralPrice?: bigint
}) {
	const client = createWriteClient(accountAddress)
	const reader = { ...securityPoolReadClient(readClient), getBalance: (request: { address: Address; blockNumber: bigint }) => readClient.getBalance(request) }
	const load = () => loadSecurityPoolPriceSnapshot({ client: reader, securityPool, owner: accountAddress, universeId: 0n })
	let price = await load()
	if (price.observation === undefined) throw new Error(priceReport.collateralUnavailable)
	const decimals = Number(await readClient.readContract({ address: price.observation.weth, abi: ABIS.mainnet.erc20, functionName: 'decimals' }))
	const repPerEth = repPerCollateralPrice ?? (DEFAULT_SIMULATION_REP_PER_ETH_PRICE * 10n ** BigInt(36 - decimals)) / 10n ** 18n
	const funding = quoteSecurityPoolPriceFunding(price, repPerEth, requestedInitialAttoWeth)
	if (funding.wrap > 0n) await sendSecurityPoolTransaction(client, buildSecurityPoolPriceWrapRequest(price, funding.wrap), priceReport.wrapEth)
	await sendSecurityPoolTransaction(client, buildSecurityPoolPriceApprovalRequest(price, 'weth', funding.weth), priceReport.approveWeth)
	await onProgressStep(priceReport.funded(poolLabel))
	await sendSecurityPoolTransaction(client, buildSecurityPoolPriceApprovalRequest(price, 'rep', funding.rep), priceReport.approveRep)
	price = await load()
	await sendSecurityPoolTransaction(client, buildSecurityPoolPriceRequest(price, repPerEth, requestedInitialAttoWeth), priceReport.reportPrice)
	await onProgressStep(priceReport.opened(poolLabel))
	price = await load()
	if (price.observation === undefined || price.observation.pendingReportId === 0n) throw new Error(priceReport.pendingReportUnavailable)
	return { openOracleAddress: price.observation.openOracle, pendingReportId: price.observation.pendingReportId }
}

export async function settleOracleReportIfNeeded({ memoryClient, readClient, writeClient, openOracleAddress, pendingReportId }: { memoryClient: TevmLikeClient; readClient: ReadClient; writeClient: WriteClient; openOracleAddress: Address; pendingReportId: bigint }) {
	const seededReport = await getScenarioProtocol().loadOpenOracleReportDetails(readClient, openOracleAddress, pendingReportId)
	if (seededReport.isDistributed) return
	const reportTimestamp = getSimulationReportTiming(seededReport.reportTimestamp)
	const settlementTime = getSimulationReportTiming(seededReport.settlementTime)
	if (reportTimestamp !== undefined && settlementTime !== undefined) {
		const settlementReadyTimestamp = reportTimestamp + settlementTime + 1n
		const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
		if (currentTimestamp < settlementReadyTimestamp) {
			await advanceSimulationTime(memoryClient, settlementReadyTimestamp - currentTimestamp)
		}
	}
	await getScenarioProtocol().settleOracleReport(writeClient, openOracleAddress, pendingReportId)
}

function getSimulationReportTiming(value: unknown) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	return undefined
}
