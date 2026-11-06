import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioPriceApprovalRequest, buildPortfolioPriceRequest, buildPortfolioPriceWrapRequest, loadPortfolioPriceSnapshot, quotePortfolioPriceFunding } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { BootstrapScenarioApplyParameters, TevmLikeClient } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { advanceSimulationTime, getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { getStatoblastScenarioProtocol as getScenarioProtocol } from './statoblastScenarioProtocol.js'
import { portfolioReadClient, sendPortfolioTransaction } from '../protocol/securityPoolPortfolio.js'

export const DAY_IN_SECONDS = 86400n
export type ScenarioSeedParameters = Omit<BootstrapScenarioApplyParameters, 'scenario'>

export async function settleSeededOracleReport({
	accountAddress,
	createWriteClient,
	portfolio,
	onProgressStep,
	poolLabel,
	readClient,
	requestedInitialAttoWeth = 0n,
}: {
	accountAddress: Address
	createWriteClient: (accountAddress: Address) => WriteClient
	portfolio: Address
	onProgressStep: (label: string) => Promise<void>
	poolLabel: string
	readClient: ReadClient
	requestedInitialAttoWeth?: bigint
}) {
	const client = createWriteClient(accountAddress)
	const reader = { ...portfolioReadClient(readClient), getBalance: (request: { address: Address; blockNumber: bigint }) => readClient.getBalance(request) }
	const load = () => loadPortfolioPriceSnapshot({ client: reader, portfolio, owner: accountAddress, universeId: 0n })
	let price = await load()
	const repPerEth = 3n * 10n ** 18n
	const funding = quotePortfolioPriceFunding(price, repPerEth, requestedInitialAttoWeth)
	if (funding.wrap > 0n) await sendPortfolioTransaction(client, buildPortfolioPriceWrapRequest(price, funding.wrap), 'Wrap report ETH')
	await sendPortfolioTransaction(client, buildPortfolioPriceApprovalRequest(price, 'weth', funding.weth), 'Approve report WETH')
	await onProgressStep(`Funded WETH price report for ${poolLabel}`)
	await sendPortfolioTransaction(client, buildPortfolioPriceApprovalRequest(price, 'rep', funding.rep), 'Approve report REP')
	price = await load()
	await sendPortfolioTransaction(client, buildPortfolioPriceRequest(price, repPerEth, requestedInitialAttoWeth), 'Report portfolio price')
	await onProgressStep(`Opened price report for ${poolLabel}`)
	price = await load()
	if (price.observation === undefined || price.observation.pendingReportId === 0n) throw new Error('Expected a pending portfolio price report')
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
