import { abiForKind } from '../abi-catalog.ts'
import { getAddress, zeroAddress, type AbiValue, type Address } from '../ethereum.ts'
import type { StateRead } from '../snapshots.ts'
import type { ContractMetadata, DecodedRecord } from '../types.ts'
import type { SystemContractKind } from '../system-interfaces.ts'

type Discovery = Omit<ContractMetadata, 'provenance'>

/** Follow immutable custody edges from canonical factory events and branch starts. */
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
	const discoverCapital = async (portfolio: Address): Promise<Discovery> => {
		const value = decoded.arguments?.['universeId']
		if ((typeof value !== 'string' && typeof value !== 'bigint') || !/^\d+$/.test(String(value)) || BigInt(value) >= 2n ** 248n) throw new Error('Portfolio capital discovery is missing its universe')
		const universe = BigInt(value)
		const capital = address(await call(portfolio, 'securityPoolPortfolio', 'capitalLedger', [universe]))
		if (capital === zeroAddress || address(await call(capital, 'securityPoolCapitalLedger', 'portfolio')) !== portfolio || (await call(capital, 'securityPoolCapitalLedger', 'universeId')) !== universe) throw new Error('Portfolio capital binding mismatch')
		if (decoded.name === 'UniversePrepared' && address(decoded.arguments?.['capitalLedger']) !== capital) throw new Error('Portfolio capital event mismatch')
		return { address: capital, kind: 'securityPoolCapitalLedger', label: 'Portfolio Capital Ledger' }
	}
	if (emitter.kind === 'securityPoolPortfolio' && decoded.name === 'UniversePrepared') return [await discoverCapital(emitterAddress)]
	if (emitter.kind === 'securityPoolFactory' && decoded.name === 'DeploySecurityPool') {
		const pool = address(decoded.arguments?.['securityPool'])
		const portfolio = address(await call(emitterAddress, 'securityPoolFactory', 'getSecurityPoolPortfolio', [pool]))
		if (portfolio === zeroAddress) throw new Error('Question ledger is missing its portfolio binding')
		if (address(await call(portfolio, 'securityPoolPortfolio', 'factory')) !== emitterAddress) throw new Error('Portfolio factory binding mismatch')
		const controller = address(await call(portfolio, 'securityPoolPortfolio', 'forkController'))
		if (controller === zeroAddress || address(await call(controller, 'securityPoolPortfolioForkCoordinator', 'portfolio')) !== portfolio) throw new Error('Portfolio fork controller binding mismatch')
		return [{ address: portfolio, kind: 'securityPoolPortfolio', label: 'Security Portfolio' }, { address: controller, kind: 'securityPoolPortfolioForkCoordinator', label: 'Portfolio Fork Coordinator' }, await discoverCapital(portfolio)]
	}
	if (emitter.kind === 'securityPoolPortfolioForkCoordinator' && decoded.name === 'BranchStarted') {
		const universe = decoded.arguments?.['universeId']
		if ((typeof universe !== 'string' && typeof universe !== 'bigint') || !/^\d+$/.test(String(universe))) throw new Error('Branch start is missing its universe')
		const auction = address(await call(emitterAddress, 'securityPoolPortfolioForkCoordinator', 'auctions', [BigInt(universe)]))
		if (auction === zeroAddress) return []
		if (address(await call(auction, 'securityPoolPortfolioAuction', 'forkAuthority')) !== emitterAddress) throw new Error('Branch auction authority mismatch')
		const engine = address(await call(auction, 'securityPoolPortfolioAuction', 'engine'))
		if (engine === zeroAddress || address(await call(engine, 'securityPoolUniformPriceAuction', 'controller')) !== auction) throw new Error('Branch auction engine binding mismatch')
		return [
			{ address: auction, kind: 'securityPoolPortfolioAuction', label: 'Portfolio Truth Auction' },
			{ address: engine, kind: 'securityPoolUniformPriceAuction', label: 'Uniform Price Auction' },
		]
	}
	return []
}
