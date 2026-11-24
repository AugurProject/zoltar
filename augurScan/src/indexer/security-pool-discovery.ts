import { abiForKind } from '../abi-catalog.ts'
import { securityPoolComponentKinds } from '../contract-discovery.ts'
import { getAddress, zeroAddress, type AbiValue, type Address } from '../ethereum.ts'
import type { StateRead } from '../snapshots.ts'
import type { ContractMetadata, DecodedRecord } from '../types.ts'
import type { SystemContractKind } from '../system-interfaces.ts'

type Discovery = Omit<ContractMetadata, 'provenance'>

const component = (name: keyof typeof securityPoolComponentKinds, address: Address): Discovery => ({ address, ...securityPoolComponentKinds[name] })

/**
 * Follow immutable custody edges from canonical factory events, universe preparations, branch starts and
 * settled price reports. Every edge is read at the event's block and checked in the reverse direction, so an
 * address is registered only when the component names the contract that named it.
 */
export async function discoverSecurityPoolEventDependencies(emitter: ContractMetadata, decoded: DecodedRecord, read: StateRead): Promise<readonly Discovery[]> {
	if (decoded.status !== 'decoded') return []
	const emitterAddress = getAddress(emitter.address)
	const call = async (address: Address, kind: SystemContractKind, name: string, args: readonly AbiValue[] = []) => {
		const abi = abiForKind(kind)
		if (abi === undefined) throw new Error(`Missing security pool discovery ABI ${kind}`)
		return await read(address, abi, name, args)
	}
	const address = (value: unknown): Address => {
		if (typeof value !== 'string') throw new Error('Security pool discovery returned an invalid address')
		return getAddress(value)
	}
	const discoverCapital = async (securityPool: Address): Promise<readonly Discovery[]> => {
		const value = decoded.arguments?.['universeId']
		if ((typeof value !== 'string' && typeof value !== 'bigint') || !/^\d+$/.test(String(value)) || BigInt(value) >= 2n ** 248n) throw new Error('Security pool capital discovery is missing its universe')
		const universe = BigInt(value)
		const capital = address(await call(securityPool, 'securityPool', 'capitalLedger', [universe]))
		if (capital === zeroAddress || address(await call(capital, 'securityPoolCapitalLedger', 'securityPool')) !== securityPool || (await call(capital, 'securityPoolCapitalLedger', 'universeId')) !== universe) throw new Error('Security pool capital binding mismatch')
		if (decoded.name === 'UniversePrepared' && address(decoded.arguments?.['capitalLedger']) !== capital) throw new Error('Security pool capital event mismatch')
		// The ledger holds the tokens; its commitment index and fee streams only account for them and emit nothing.
		const index = address(await call(capital, 'securityPoolCapitalLedger', 'commitmentIndex'))
		if (index === zeroAddress || address(await call(index, 'securityPoolCommitmentIndex', 'capitalLedger')) !== capital) throw new Error('Security pool capital commitment index binding mismatch')
		const streams = address(await call(capital, 'securityPoolCapitalLedger', 'feeStreams'))
		if (streams === zeroAddress || address(await call(streams, 'securityPoolCapitalFeeStreams', 'capitalLedger')) !== capital) throw new Error('Security pool capital fee streams binding mismatch')
		return [component('capitalLedger', capital), component('commitmentIndex', index), component('feeStreams', streams)]
	}
	// Setup deploys services in the constructor and settlement, its book and the reporter ledger before any question can be added.
	const discoverModules = async (securityPool: Address): Promise<readonly Discovery[]> => {
		const services = address(await call(securityPool, 'securityPool', 'services'))
		if (services === zeroAddress || address(await call(services, 'securityPoolServices', 'securityPool')) !== securityPool) throw new Error('Security pool services binding mismatch')
		const settlement = address(await call(securityPool, 'securityPool', 'settlement'))
		if (settlement === zeroAddress || address(await call(settlement, 'securityPoolSettlement', 'securityPool')) !== securityPool) throw new Error('Security pool settlement binding mismatch')
		const book = address(await call(settlement, 'securityPoolSettlement', 'ledger'))
		if (book === zeroAddress || address(await call(book, 'securityPoolSettlementBook', 'securityPool')) !== settlement) throw new Error('Security pool settlement book binding mismatch')
		const reporters = address(await call(securityPool, 'securityPool', 'reporters'))
		if (reporters === zeroAddress || address(await call(reporters, 'securityPoolReporterLedger', 'securityPool')) !== securityPool) throw new Error('Security pool reporter ledger binding mismatch')
		return [component('services', services), component('settlement', settlement), component('settlementBook', book), component('reporterLedger', reporters)]
	}
	if (emitter.kind === 'securityPool' && decoded.name === 'UniversePrepared') return await discoverCapital(emitterAddress)
	// The escrow settles its report on the feed and then emits `ReportCompleted`, so the feed's decision (or its
	// base-fee deferral) and the escrow's event share one transaction. Registering the escrow there lets the receipt supply its only event.
	if (emitter.kind === 'sharedPoolPriceFeed' && (decoded.name === 'PriceReported' || decoded.name === 'PriceReportRejected' || decoded.name === 'PriceReportDeferred')) {
		const report = decoded.arguments?.['reportId']
		if ((typeof report !== 'string' && typeof report !== 'bigint') || !/^\d+$/.test(String(report))) throw new Error('Report decision is missing its report')
		const candidate = await call(emitterAddress, 'sharedPoolPriceFeed', 'reportCandidates', [BigInt(report)])
		if (!Array.isArray(candidate)) throw new Error('Report candidate returned an invalid tuple')
		const escrow = address(candidate[0])
		if (escrow === zeroAddress || address(await call(escrow, 'sharedPoolReportEscrow', 'feed')) !== emitterAddress) throw new Error('Report escrow binding mismatch')
		return [component('reportEscrow', escrow)]
	}
	if (emitter.kind === 'securityPoolFactory' && decoded.name === 'DeployQuestionLedger') {
		const pool = address(decoded.arguments?.['questionLedger'])
		const securityPool = address(await call(emitterAddress, 'securityPoolFactory', 'securityPoolOf', [pool]))
		if (securityPool === zeroAddress) throw new Error('Question ledger is missing its security pool binding')
		if (address(await call(securityPool, 'securityPool', 'factory')) !== emitterAddress) throw new Error('Security pool factory binding mismatch')
		const controller = address(await call(securityPool, 'securityPool', 'forkController'))
		if (controller === zeroAddress || address(await call(controller, 'securityPoolForkCoordinator', 'securityPool')) !== securityPool) throw new Error('Security pool fork controller binding mismatch')
		return [component('securityPool', securityPool), component('forkCoordinator', controller), ...(await discoverModules(securityPool)), ...(await discoverCapital(securityPool))]
	}
	if (emitter.kind === 'securityPoolForkCoordinator' && decoded.name === 'BranchStarted') {
		const universe = decoded.arguments?.['universeId']
		if ((typeof universe !== 'string' && typeof universe !== 'bigint') || !/^\d+$/.test(String(universe))) throw new Error('Branch start is missing its universe')
		const auction = address(await call(emitterAddress, 'securityPoolForkCoordinator', 'repairAuctions', [BigInt(universe)]))
		if (auction === zeroAddress) return []
		if (address(await call(auction, 'securityPoolRepairAuction', 'forkAuthority')) !== emitterAddress) throw new Error('Branch auction authority mismatch')
		const engine = address(await call(auction, 'securityPoolRepairAuction', 'engine'))
		if (engine === zeroAddress || address(await call(engine, 'securityPoolUniformPriceRepairAuction', 'controller')) !== auction) throw new Error('Branch auction engine binding mismatch')
		return [component('securityPoolRepairAuction', auction), component('uniformPriceAuction', engine)]
	}
	return []
}
