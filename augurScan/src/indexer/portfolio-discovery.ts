import { abiForKind } from '../abi-catalog.ts'
import { portfolioComponentKinds } from '../contract-discovery.ts'
import { getAddress, zeroAddress, type AbiValue, type Address } from '../ethereum.ts'
import type { StateRead } from '../snapshots.ts'
import type { ContractMetadata, DecodedRecord } from '../types.ts'
import type { SystemContractKind } from '../system-interfaces.ts'

type Discovery = Omit<ContractMetadata, 'provenance'>

const component = (name: keyof typeof portfolioComponentKinds, address: Address): Discovery => ({ address, ...portfolioComponentKinds[name] })

/**
 * Follow immutable custody edges from canonical factory events, universe preparations, branch starts and
 * settled price reports. Every edge is read at the event's block and checked in the reverse direction, so an
 * address is registered only when the component names the contract that named it.
 */
export async function discoverPortfolioEventDependencies(emitter: ContractMetadata, decoded: DecodedRecord, read: StateRead): Promise<readonly Discovery[]> {
	if (decoded.status !== 'decoded') return []
	const emitterAddress = getAddress(emitter.address)
	const call = async (address: Address, kind: SystemContractKind, name: string, args: readonly AbiValue[] = []) => {
		const abi = abiForKind(kind)
		if (abi === undefined) throw new Error(`Missing portfolio discovery ABI ${kind}`)
		return await read(address, abi, name, args)
	}
	const address = (value: unknown): Address => {
		if (typeof value !== 'string') throw new Error('Portfolio discovery returned an invalid address')
		return getAddress(value)
	}
	const discoverCapital = async (portfolio: Address): Promise<readonly Discovery[]> => {
		const value = decoded.arguments?.['universeId']
		if ((typeof value !== 'string' && typeof value !== 'bigint') || !/^\d+$/.test(String(value)) || BigInt(value) >= 2n ** 248n) throw new Error('Portfolio capital discovery is missing its universe')
		const universe = BigInt(value)
		const capital = address(await call(portfolio, 'securityPoolPortfolio', 'capitalLedger', [universe]))
		if (capital === zeroAddress || address(await call(capital, 'securityPoolCapitalLedger', 'portfolio')) !== portfolio || (await call(capital, 'securityPoolCapitalLedger', 'universeId')) !== universe) throw new Error('Portfolio capital binding mismatch')
		if (decoded.name === 'UniversePrepared' && address(decoded.arguments?.['capitalLedger']) !== capital) throw new Error('Portfolio capital event mismatch')
		// The ledger holds the tokens; its commitment index and fee streams only account for them and emit nothing.
		const index = address(await call(capital, 'securityPoolCapitalLedger', 'commitmentIndex'))
		if (index === zeroAddress || address(await call(index, 'securityPoolCommitmentIndex', 'capitalLedger')) !== capital) throw new Error('Portfolio capital commitment index binding mismatch')
		const streams = address(await call(capital, 'securityPoolCapitalLedger', 'feeStreams'))
		if (streams === zeroAddress || address(await call(streams, 'securityPoolCapitalFeeStreams', 'capitalLedger')) !== capital) throw new Error('Portfolio capital fee streams binding mismatch')
		return [component('capitalLedger', capital), component('commitmentIndex', index), component('feeStreams', streams)]
	}
	// Setup deploys services in the constructor and settlement, its book and the reporter ledger before any question can be added.
	const discoverModules = async (portfolio: Address): Promise<readonly Discovery[]> => {
		const services = address(await call(portfolio, 'securityPoolPortfolio', 'services'))
		if (services === zeroAddress || address(await call(services, 'securityPoolPortfolioServices', 'portfolio')) !== portfolio) throw new Error('Portfolio services binding mismatch')
		const settlement = address(await call(portfolio, 'securityPoolPortfolio', 'settlement'))
		if (settlement === zeroAddress || address(await call(settlement, 'securityPoolPortfolioSettlement', 'portfolio')) !== portfolio) throw new Error('Portfolio settlement binding mismatch')
		const book = address(await call(settlement, 'securityPoolPortfolioSettlement', 'ledger'))
		if (book === zeroAddress || address(await call(book, 'securityPoolSettlementBook', 'portfolio')) !== settlement) throw new Error('Portfolio settlement book binding mismatch')
		const reporters = address(await call(portfolio, 'securityPoolPortfolio', 'reporters'))
		if (reporters === zeroAddress || address(await call(reporters, 'securityPoolReporterLedger', 'portfolio')) !== portfolio) throw new Error('Portfolio reporter ledger binding mismatch')
		return [component('services', services), component('settlement', settlement), component('settlementBook', book), component('reporterLedger', reporters)]
	}
	if (emitter.kind === 'securityPoolPortfolio' && decoded.name === 'UniversePrepared') return await discoverCapital(emitterAddress)
	// The escrow settles its report on the feed and then emits `ReportCompleted`, so the feed's decision and the
	// escrow's event share one transaction. Registering the escrow at that decision lets the receipt supply its only event.
	if (emitter.kind === 'sharedPoolPriceFeed' && (decoded.name === 'PriceReported' || decoded.name === 'PriceReportRejected')) {
		const report = decoded.arguments?.['reportId']
		if ((typeof report !== 'string' && typeof report !== 'bigint') || !/^\d+$/.test(String(report))) throw new Error('Report decision is missing its report')
		const candidate = await call(emitterAddress, 'sharedPoolPriceFeed', 'reportCandidates', [BigInt(report)])
		if (!Array.isArray(candidate)) throw new Error('Report candidate returned an invalid tuple')
		const escrow = address(candidate[0])
		if (escrow === zeroAddress || address(await call(escrow, 'sharedPoolReportEscrow', 'feed')) !== emitterAddress) throw new Error('Report escrow binding mismatch')
		return [component('reportEscrow', escrow)]
	}
	if (emitter.kind === 'securityPoolFactory' && decoded.name === 'DeploySecurityPool') {
		const pool = address(decoded.arguments?.['securityPool'])
		const portfolio = address(await call(emitterAddress, 'securityPoolFactory', 'getSecurityPoolPortfolio', [pool]))
		if (portfolio === zeroAddress) throw new Error('Question ledger is missing its portfolio binding')
		if (address(await call(portfolio, 'securityPoolPortfolio', 'factory')) !== emitterAddress) throw new Error('Portfolio factory binding mismatch')
		const controller = address(await call(portfolio, 'securityPoolPortfolio', 'forkController'))
		if (controller === zeroAddress || address(await call(controller, 'securityPoolPortfolioForkCoordinator', 'portfolio')) !== portfolio) throw new Error('Portfolio fork controller binding mismatch')
		return [component('portfolio', portfolio), component('forkCoordinator', controller), ...(await discoverModules(portfolio)), ...(await discoverCapital(portfolio))]
	}
	if (emitter.kind === 'securityPoolPortfolioForkCoordinator' && decoded.name === 'BranchStarted') {
		const universe = decoded.arguments?.['universeId']
		if ((typeof universe !== 'string' && typeof universe !== 'bigint') || !/^\d+$/.test(String(universe))) throw new Error('Branch start is missing its universe')
		const auction = address(await call(emitterAddress, 'securityPoolPortfolioForkCoordinator', 'auctions', [BigInt(universe)]))
		if (auction === zeroAddress) return []
		if (address(await call(auction, 'securityPoolPortfolioAuction', 'forkAuthority')) !== emitterAddress) throw new Error('Branch auction authority mismatch')
		const engine = address(await call(auction, 'securityPoolPortfolioAuction', 'engine'))
		if (engine === zeroAddress || address(await call(engine, 'securityPoolUniformPriceAuction', 'controller')) !== auction) throw new Error('Branch auction engine binding mismatch')
		return [component('portfolioAuction', auction), component('uniformPriceAuction', engine)]
	}
	return []
}
