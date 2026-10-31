import { getAddress, parseAbi, type AbiValue, type Address } from '@zoltar/core-shared/evm/ethereum'
import { loadPortfolioAuctionSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalLifecycleDelegate_SecurityPoolCapitalLifecycleDelegate as lifecycleArtifact,
	statoblast_SecurityPoolCapitalAuctionDelegate_SecurityPoolCapitalAuctionDelegate as auctionDelegateArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as feesArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
} from '../contractArtifact.js'
import { getInfraContractAddresses, getSecurityPoolPortfolioRuntimeCode } from './deploymentHelpers.js'
import { portfolioReadClient, verifyRuntimeCode } from './securityPoolPortfolio.js'
import { requireAddressValue, requireBigintValue, requireTupleValue, requireObjectValue } from './decoders.js'

const vaultIdentityAbi = parseAbi([
	'function owner() view returns (address)',
	'function initialCapital() view returns (address)',
	'function auction() view returns (address)',
	'function bidId() view returns (uint256)',
	'function forkController() view returns (address)',
	'function factory() view returns (address)',
	'function portfolio() view returns (address)',
	'function lifecycleDelegate() view returns (address)',
	'function auctionDelegate() view returns (address)',
	'function commitmentIndex() view returns (address)',
	'function feeStreams() view returns (address)',
	'function services() view returns (address)',
	'function ledger() view returns (address)',
	'function auctionDeployer() view returns (address)',
	'function zoltar() view returns (address)',
	'function universeId() view returns (uint248)',
	'function capital() view returns (address)',
	'function forkAuthority() view returns (address)',
	'function engine() view returns (address)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function auctions(uint248 universeId) view returns (address)',
	'function controller() view returns (address)',
	'function bids(uint256 id) view returns (address bidder,address vault,uint256 targetHealthBps,uint256 lots,uint256 minimumAttoRepPerLot,bool settled,bool feesRemoved)',
	'function bidIdForVault(address vault) view returns (uint256)',
	'function finalized() view returns (bool)',
	'function previewBid(uint256 id) view returns ((address bidder,address vault,uint256 targetHealthBps,uint256 filledLots,uint256 usedAttoEth,uint256 principalAttoRep,uint256 refundAttoEth) fill)',
	'function auctionPosition(uint256 bidId) view returns ((address vault,uint96 positionId,uint256 principal,uint256 commitment,uint256 targetHealthFactorBps,uint48 liquidationStarted,bool materialized,uint256 earnedAttoEth,uint256 earnedAttoRep) result)',
])

/** Authenticate compiler runtime and canonical bindings before presenting any funding action. */
export async function loadPortfolioBranchAuction(client: ReadClient, portfolio: Address, bidder: Address, universeId: bigint, bidStart = 0n) {
	const snapshot = await loadPortfolioAuctionSnapshot({ client: { ...portfolioReadClient(client), getBalance: parameters => client.getBalance(parameters) }, portfolio, bidder, universeId, bidStart })
	const infrastructure = getInfraContractAddresses()
	if (getAddress(snapshot.factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(snapshot.zoltar) !== getAddress(infrastructure.zoltar)) throw new Error('Portfolio uses unrecognized auction infrastructure.')
	const blockNumber = snapshot.blockNumber
	verifyRuntimeCode(await client.getCode({ address: portfolio, blockNumber }), getSecurityPoolPortfolioRuntimeCode(), portfolioArtifact.evm.deployedBytecode.immutableReferences, 'portfolio')
	const modules: { address: Address; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }; label: string }[] = [{ address: snapshot.controller, artifact: forkArtifact, label: 'fork coordinator' }]
	const auction = snapshot.auction
	if (auction !== undefined) {
		await verifyAuctionCapitalCustody(client, portfolio, snapshot.capitalLedger, blockNumber)
		modules.push({ address: snapshot.capitalLedger, artifact: capitalArtifact, label: 'capital ledger' }, { address: auction.address, artifact: auctionArtifact, label: 'portfolio auction' }, { address: auction.engine, artifact: engineArtifact, label: 'auction engine' })
		for (const bid of auction.bids) modules.push({ address: bid.vault, artifact: vaultArtifact, label: 'auction vault' })
	}
	await Promise.all(modules.map(async module => verifyRuntimeCode(await client.getCode({ address: module.address, blockNumber }), `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)))
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Auction authentication changed. Refresh and retry.')
	return snapshot
}

/** Authenticate one selected vault directly, including its original branch after later forks. */
export async function authenticatePortfolioAuctionVault(client: ReadClient, portfolio: Address, vault: Address, blockNumber: bigint) {
	const read = (address: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ abi: vaultIdentityAbi, address, functionName, args, blockNumber })
	verifyRuntimeCode(await client.getCode({ address: vault, blockNumber }), `0x${vaultArtifact.evm.deployedBytecode.object}`, vaultArtifact.evm.deployedBytecode.immutableReferences, 'auction vault')
	const [ownerValue, capitalValue, auctionValue, idValue, controllerValue, protocolValue, factoryValue] = await Promise.all([read(vault, 'owner'), read(vault, 'initialCapital'), read(vault, 'auction'), read(vault, 'bidId'), read(portfolio, 'forkController'), read(portfolio, 'zoltar'), read(portfolio, 'factory')])
	const bidder = requireAddressValue(ownerValue, 'auction vault owner')
	const initialCapital = requireAddressValue(capitalValue, 'initial auction capital')
	const auction = requireAddressValue(auctionValue, 'vault auction')
	const bidId = requireBigintValue(idValue, 'vault bid ID')
	const controller = requireAddressValue(controllerValue, 'fork coordinator')
	const zoltar = requireAddressValue(protocolValue, 'portfolio protocol')
	const infrastructure = getInfraContractAddresses()
	if (getAddress(requireAddressValue(factoryValue, 'portfolio factory')) !== getAddress(infrastructure.securityPoolFactory) || getAddress(zoltar) !== getAddress(infrastructure.zoltar) || bidId <= 0n) throw new Error('Auction vault uses unrecognized portfolio infrastructure.')
	const [universeValue, capitalRoot, capitalProtocol, auctionRoot, auctionCapital, auctionFork, auctionUniverse, engineValue, controllerRoot] = await Promise.all([
		read(initialCapital, 'universeId'),
		read(initialCapital, 'portfolio'),
		read(initialCapital, 'zoltar'),
		read(auction, 'portfolio'),
		read(auction, 'capital'),
		read(auction, 'forkAuthority'),
		read(auction, 'universeId'),
		read(auction, 'engine'),
		read(controller, 'portfolio'),
	])
	const initialUniverse = requireBigintValue(universeValue, 'initial auction universe')
	const engine = requireAddressValue(engineValue, 'auction engine')
	const [canonicalCapital, canonicalAuction, engineController, bidValue, registeredId] = await Promise.all([read(portfolio, 'capitalLedger', [initialUniverse]), read(controller, 'auctions', [initialUniverse]), read(engine, 'controller'), read(engine, 'bids', [bidId]), read(auction, 'bidIdForVault', [vault])])
	const bid = requireTupleValue(bidValue, 7, 'auction bid')
	if (
		[capitalRoot, auctionRoot, controllerRoot].some(value => getAddress(requireAddressValue(value, 'module portfolio')) !== getAddress(portfolio)) ||
		getAddress(requireAddressValue(capitalProtocol, 'capital protocol')) !== getAddress(zoltar) ||
		getAddress(requireAddressValue(auctionCapital, 'auction capital')) !== getAddress(initialCapital) ||
		getAddress(requireAddressValue(auctionFork, 'auction fork authority')) !== getAddress(controller) ||
		requireBigintValue(auctionUniverse, 'auction universe') !== initialUniverse ||
		getAddress(requireAddressValue(canonicalCapital, 'canonical capital')) !== getAddress(initialCapital) ||
		getAddress(requireAddressValue(canonicalAuction, 'canonical auction')) !== getAddress(auction) ||
		getAddress(requireAddressValue(engineController, 'engine controller')) !== getAddress(auction) ||
		getAddress(requireAddressValue(bid[0], 'bid owner')) !== getAddress(bidder) ||
		getAddress(requireAddressValue(bid[1], 'bid vault')) !== getAddress(vault) ||
		requireBigintValue(registeredId, 'registered bid') !== bidId
	)
		throw new Error('Auction vault does not belong to the selected portfolio and bidder.')
	await Promise.all([
		client.getCode({ address: portfolio, blockNumber }).then(code => verifyRuntimeCode(code, getSecurityPoolPortfolioRuntimeCode(), portfolioArtifact.evm.deployedBytecode.immutableReferences, 'portfolio')),
		...[
			{ address: controller, artifact: forkArtifact, label: 'fork coordinator' },
			{ address: initialCapital, artifact: capitalArtifact, label: 'initial capital ledger' },
			{ address: auction, artifact: auctionArtifact, label: 'portfolio auction' },
			{ address: engine, artifact: engineArtifact, label: 'auction engine' },
		].map(async module => verifyRuntimeCode(await client.getCode({ address: module.address, blockNumber }), `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)),
	])
	await verifyAuctionCapitalCustody(client, portfolio, initialCapital, blockNumber)
	const finalized = await read(engine, 'finalized')
	if (typeof finalized !== 'boolean') throw new Error('Invalid auction finalization state.')
	let filledLots = 0n
	let materialized = false
	if (finalized) {
		const fill = requireObjectValue(await read(engine, 'previewBid', [bidId]), 'winning auction fill')
		filledLots = requireBigintValue(Reflect.get(fill, 'filledLots'), 'winning auction lots')
		if (getAddress(requireAddressValue(Reflect.get(fill, 'vault'), 'fill vault')) !== getAddress(vault) || getAddress(requireAddressValue(Reflect.get(fill, 'bidder'), 'fill bidder')) !== getAddress(bidder)) throw new Error('Auction fill identity mismatch.')
		if (filledLots > 0n) {
			const position = requireObjectValue(await read(initialCapital, 'auctionPosition', [bidId]), 'auction position')
			const materializedValue = Reflect.get(position, 'materialized')
			if (getAddress(requireAddressValue(Reflect.get(position, 'vault'), 'position vault')) !== getAddress(vault) || typeof materializedValue !== 'boolean') throw new Error('Invalid auction position identity.')
			materialized = materializedValue
		}
	}
	return { vault: getAddress(vault), bidder: getAddress(bidder), auction: getAddress(auction), initialCapital: getAddress(initialCapital), initialUniverse, bidId, filledLots, materialized }
}

/** Delegate and accounting contracts can spend or mutate deposited capital. */
async function verifyAuctionCapitalCustody(client: ReadClient, portfolio: Address, capitalLedger: Address, blockNumber: bigint) {
	const read = (address: Address, functionName: string) => client.readContract({ abi: vaultIdentityAbi, address, functionName, blockNumber })
	const [lifecycle, auctionDelegate, index, fees, capitalServices, portfolioServices, deployer] = await Promise.all([
		read(capitalLedger, 'lifecycleDelegate'),
		read(capitalLedger, 'auctionDelegate'),
		read(capitalLedger, 'commitmentIndex'),
		read(capitalLedger, 'feeStreams'),
		read(capitalLedger, 'services'),
		read(portfolio, 'services'),
		read(portfolio, 'auctionDeployer'),
	])
	if (getAddress(requireAddressValue(capitalServices, 'capital services')) !== getAddress(requireAddressValue(portfolioServices, 'portfolio services')) || getAddress(requireAddressValue(deployer, 'auction deployer')) !== getAddress(getInfraContractAddresses().securityPoolPortfolioAuctionDeployer))
		throw new Error('Auction custody uses another services authority or deployer.')
	const modules = [
		{ value: lifecycle, artifact: lifecycleArtifact, label: 'capital lifecycle delegate', getter: 'ledger', authority: capitalLedger },
		{ value: auctionDelegate, artifact: auctionDelegateArtifact, label: 'capital auction delegate', getter: 'ledger', authority: capitalLedger },
		{ value: index, artifact: indexArtifact, label: 'commitment index', getter: 'portfolio', authority: capitalLedger },
		{ value: fees, artifact: feesArtifact, label: 'capital fee streams', getter: 'portfolio', authority: capitalLedger },
		{ value: portfolioServices, artifact: servicesArtifact, label: 'portfolio services', getter: 'portfolio', authority: portfolio },
	]
	await Promise.all(
		modules.map(async module => {
			const address = requireAddressValue(module.value, module.label)
			const [code, authority] = await Promise.all([client.getCode({ address, blockNumber }), read(address, module.getter)])
			verifyRuntimeCode(code, `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)
			if (getAddress(requireAddressValue(authority, 'custody module authority')) !== getAddress(module.authority)) throw new Error(`${module.label} belongs to another authority.`)
		}),
	)
}
