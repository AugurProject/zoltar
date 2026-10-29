import { portfolioRuntimeIdentities } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, parseAbiItem, type Address } from '@zoltar/bot-shared/ethereum'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import type { PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from './vault-positions.ts'

const links = [
	parseAbiItem('function forkAuthority() view returns (address)'),
	parseAbiItem('function zoltar() view returns (address)'),
	parseAbiItem('function requiredExecutionReserve(uint256 commitment) view returns (uint256)'),
	parseAbiItem('function portfolio() view returns (address)'),
	parseAbiItem('function ledger() view returns (address)'),
	parseAbiItem('function settlement() view returns (address)'),
	parseAbiItem('function reporters() view returns (address)'),
	parseAbiItem('function quoteHelper() view returns (address)'),
	parseAbiItem('function forkController() view returns (address)'),
	parseAbiItem('function feeStreams() view returns (address)'),
	parseAbiItem('function services() view returns (address)'),
	parseAbiItem('function lifecycleDelegate() view returns (address)'),
	parseAbiItem('function auctionDelegate() view returns (address)'),
	parseAbiItem('function reportingRewards() view returns (address)'),
	parseAbiItem('function premiumLedger() view returns (address)'),
] as const

type RuntimeName = keyof typeof portfolioRuntimeIdentities

/** Factory namespaces are public. Authenticate every reachable custody implementation before trusting returned links. */
export async function verifyPortfolioCustody(client: ReadClient, snapshot: PortfolioCapitalSnapshot, protocol: Address) {
	const blockNumber = snapshot.blockNumber
	const readAddress = async (address: Address, functionName: string) => {
		const value = await client.readContract({ address, abi: links, functionName, blockNumber })
		if (typeof value !== 'string') throw new Error(`Invalid portfolio ${functionName} address`)
		return getAddress(value)
	}
	const verifyCode = async (address: Address, name: RuntimeName) => verifyRuntimeIdentity(await client.getCode({ address, blockNumber }), portfolioRuntimeIdentities[name], name)
	const verifyModule = async (address: Address, name: RuntimeName, authority: Address, authorityFunction = 'portfolio') => {
		await verifyCode(address, name)
		if ((await readAddress(address, authorityFunction)) !== authority) throw new Error(`${name} belongs to another authority`)
	}
	await verifyCode(snapshot.portfolio, 'SecurityPoolPortfolio')
	const [settlement, reporters, quote, fork, fees, services, lifecycle, auctionDelegate] = await Promise.all([
		readAddress(snapshot.portfolio, 'settlement'),
		readAddress(snapshot.portfolio, 'reporters'),
		readAddress(snapshot.portfolio, 'quoteHelper'),
		readAddress(snapshot.portfolio, 'forkController'),
		readAddress(snapshot.capitalLedger, 'feeStreams'),
		readAddress(snapshot.portfolio, 'services'),
		readAddress(snapshot.capitalLedger, 'lifecycleDelegate'),
		readAddress(snapshot.capitalLedger, 'auctionDelegate'),
	])
	const [book, rewards, premium, capitalServices, forkAuthority] = await Promise.all([readAddress(settlement, 'ledger'), readAddress(services, 'reportingRewards'), readAddress(services, 'premiumLedger'), readAddress(snapshot.capitalLedger, 'services'), readAddress(snapshot.capitalLedger, 'forkAuthority')])
	if (capitalServices !== services) throw new Error('Capital ledger uses another services authority')
	if (forkAuthority !== fork) throw new Error('Capital ledger uses another fork authority')
	for (const module of [snapshot.capitalLedger, reporters, fork]) if ((await readAddress(module, 'zoltar')) !== protocol) throw new Error('Portfolio custody module uses another protocol')
	const minimum = snapshot.economics.minimumCommitmentAttoEth
	const reserve = snapshot.economics.minimumExecutionReserveAttoEth
	for (const { commitment, expected } of [
		{ commitment: 1n, expected: reserve },
		{ commitment: minimum, expected: reserve },
		{ commitment: minimum + 1n, expected: reserve * 2n },
	]) {
		const actual = await client.readContract({ address: snapshot.capitalLedger, abi: links, functionName: 'requiredExecutionReserve', args: [commitment], blockNumber })
		if (actual !== expected) throw new Error('Capital execution reserve policy differs from the portfolio economics')
	}
	await Promise.all([
		verifyModule(snapshot.capitalLedger, 'SecurityPoolCapitalLedger', snapshot.portfolio),
		verifyModule(snapshot.commitmentIndex, 'SecurityPoolCommitmentIndex', snapshot.capitalLedger),
		verifyModule(fees, 'SecurityPoolCapitalFeeStreams', snapshot.capitalLedger),
		verifyModule(settlement, 'SecurityPoolPortfolioSettlement', snapshot.portfolio),
		verifyModule(book, 'SecurityPoolSettlementBook', settlement),
		verifyModule(reporters, 'SecurityPoolReporterLedger', snapshot.portfolio),
		verifyModule(quote, 'SecurityPoolPortfolioPurchase', snapshot.portfolio),
		verifyModule(fork, 'SecurityPoolPortfolioForkCoordinator', snapshot.portfolio),
		verifyModule(services, 'SecurityPoolPortfolioServices', snapshot.portfolio),
		verifyModule(lifecycle, 'SecurityPoolCapitalLifecycleDelegate', snapshot.capitalLedger, 'ledger'),
		verifyModule(auctionDelegate, 'SecurityPoolCapitalAuctionDelegate', snapshot.capitalLedger, 'ledger'),
		verifyModule(rewards, 'SecurityPoolReportingRewards', snapshot.portfolio),
		verifyModule(premium, 'SecurityPoolResolutionPremiumBook', services, 'services'),
	])
	if ((await readAddress(rewards, 'services')) !== services) throw new Error('Reporting rewards use another services authority')
}
