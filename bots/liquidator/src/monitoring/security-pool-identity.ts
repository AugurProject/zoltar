import { securityPoolRuntimeIdentities } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, parseAbiItem, type Address } from '@zoltar/bot-shared/ethereum'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import { boundCloneImplementation, boundCloneRuntimeCode, universeCloneBindings, verifyBoundCloneCode, type SecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from './read-client.ts'

const links = [
	parseAbiItem('function forkAuthority() view returns (address)'),
	parseAbiItem('function zoltar() view returns (address)'),
	parseAbiItem('function securityPool() view returns (address)'),
	parseAbiItem('function capitalImplementation() view returns (address)'),
	parseAbiItem('function capitalLedger() view returns (address)'),
	parseAbiItem('function implementation() view returns (address)'),
	parseAbiItem('function ledger() view returns (address)'),
	parseAbiItem('function settlement() view returns (address)'),
	parseAbiItem('function reporters() view returns (address)'),
	parseAbiItem('function quoteHelper() view returns (address)'),
	parseAbiItem('function forkController() view returns (address)'),
	parseAbiItem('function feeStreams() view returns (address)'),
	parseAbiItem('function services() view returns (address)'),
	parseAbiItem('function lifecycleDelegate() view returns (address)'),
	parseAbiItem('function auctionDelegate() view returns (address)'),
	parseAbiItem('function premiumLedger() view returns (address)'),
] as const

type RuntimeName = keyof typeof securityPoolRuntimeIdentities

/** Factory namespaces are public. Authenticate every reachable custody implementation before trusting returned links. */
export async function verifySecurityPoolCustody(client: ReadClient, snapshot: SecurityPoolCapitalSnapshot, protocol: Address) {
	const blockNumber = snapshot.blockNumber
	const readAddress = async (address: Address, functionName: string) => {
		const value = await client.readContract({ address, abi: links, functionName, blockNumber })
		if (typeof value !== 'string') throw new Error(`Invalid security pool ${functionName} address`)
		return getAddress(value)
	}
	const verifyCode = async (address: Address, name: RuntimeName) => verifyRuntimeIdentity(await client.getCode({ address, blockNumber }), securityPoolRuntimeIdentities[name], name)
	const verifyModule = async (address: Address, name: RuntimeName, authority: Address, authorityFunction = 'securityPool') => {
		await verifyCode(address, name)
		if ((await readAddress(address, authorityFunction)) !== authority) throw new Error(`${name} belongs to another authority`)
	}
	const verifyCapitalClone = async (address: Address, name: RuntimeName) => {
		const implementation = boundCloneImplementation(await client.getCode({ address, blockNumber }), snapshot.capitalLedger, name)
		await verifyCode(implementation, name)
		if ((await readAddress(address, 'capitalLedger')) !== snapshot.capitalLedger) throw new Error(`${name} belongs to another authority`)
	}
	await verifyCode(snapshot.securityPool, 'SecurityPool')
	const [settlement, reporters, quote, fork, fees, services, lifecycle, auctionDelegate] = await Promise.all([
		readAddress(snapshot.securityPool, 'settlement'),
		readAddress(snapshot.securityPool, 'reporters'),
		readAddress(snapshot.securityPool, 'quoteHelper'),
		readAddress(snapshot.securityPool, 'forkController'),
		readAddress(snapshot.capitalLedger, 'feeStreams'),
		readAddress(snapshot.securityPool, 'services'),
		readAddress(snapshot.capitalLedger, 'lifecycleDelegate'),
		readAddress(snapshot.capitalLedger, 'auctionDelegate'),
	])
	const [book, premium, capitalServices, forkAuthority] = await Promise.all([readAddress(settlement, 'ledger'), readAddress(services, 'premiumLedger'), readAddress(snapshot.capitalLedger, 'services'), readAddress(snapshot.capitalLedger, 'forkAuthority')])
	if (capitalServices !== services) throw new Error('Capital ledger uses another services authority')
	if (forkAuthority !== fork) throw new Error('Capital ledger uses another fork authority')
	for (const module of [snapshot.capitalLedger, reporters, fork]) if ((await readAddress(module, 'zoltar')) !== protocol) throw new Error('Security pool custody module uses another protocol')
	const capitalImplementation = await readAddress(snapshot.securityPool, 'capitalImplementation')
	const expected = boundCloneRuntimeCode(capitalImplementation, universeCloneBindings(snapshot.universeId, snapshot.repToken))
	verifyBoundCloneCode(await client.getCode({ address: snapshot.capitalLedger, blockNumber }), expected, 'capital ledger')
	await Promise.all([
		verifyModule(capitalImplementation, 'SecurityPoolCapitalLedger', snapshot.securityPool),
		verifyCapitalClone(snapshot.commitmentIndex, 'SecurityPoolCommitmentIndex'),
		verifyCapitalClone(fees, 'SecurityPoolCapitalFeeStreams'),
		verifyModule(settlement, 'SecurityPoolSettlement', snapshot.securityPool),
		verifyModule(book, 'SecurityPoolSettlementBook', settlement),
		verifyModule(reporters, 'SecurityPoolReporterLedger', snapshot.securityPool),
		verifyModule(quote, 'SecurityPoolPurchase', snapshot.securityPool),
		verifyModule(fork, 'SecurityPoolForkCoordinator', snapshot.securityPool),
		verifyModule(services, 'SecurityPoolServices', snapshot.securityPool),
		verifyModule(lifecycle, 'SecurityPoolCapitalLifecycleDelegate', lifecycle, 'implementation'),
		verifyModule(auctionDelegate, 'SecurityPoolCapitalAuctionDelegate', auctionDelegate, 'implementation'),
		verifyModule(premium, 'SecurityPoolResolutionPremiumBook', services, 'services'),
	])
}
