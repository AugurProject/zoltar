import { collateralPresentation } from './collateral.js'
import { getAddress, parseAbi, type AbiValue, type Address } from '@zoltar/core-shared/evm/ethereum'
import { decodeAuctionVaultBindings, loadSecurityPoolAuctionSnapshot, predictAuctionVaultAddress, verifyAuctionVaultCode, type SecurityPoolAuctionBid } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { decodeStoredValue, isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { statoblastDisplayCache } from './statoblastPageCache.js'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLifecycleDelegate_SecurityPoolCapitalLifecycleDelegate as lifecycleArtifact,
	statoblast_SecurityPoolCapitalRepairAuctionDelegate_SecurityPoolCapitalRepairAuctionDelegate as auctionDelegateArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as feesArtifact,
	statoblast_SecurityPoolServices_SecurityPoolServices as servicesArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolRepairAuctionVault_SecurityPoolRepairAuctionVault as vaultArtifact,
} from '../contractArtifact.js'
import { getInfraContractAddresses, getSecurityPoolRuntimeCode } from './deploymentHelpers.js'
import { securityPoolReadClient, verifyCapitalLedgerClone, verifyCapitalModuleClone, verifyRuntimeCode } from './securityPool.js'
import { requireAddressValue, requireBigintValue, requireTupleValue, requireObjectValue } from './decoders.js'

const vaultIdentityAbi = parseAbi([
	'function owner() view returns (address)',
	'function initialCapital() view returns (address)',
	'function repairAuction() view returns (address)',
	'function bidId() view returns (uint256)',
	'function vaultImplementation() view returns (address)',
	'function forkController() view returns (address)',
	'function factory() view returns (address)',
	'function securityPool() view returns (address)',
	'function lifecycleDelegate() view returns (address)',
	'function repairAuctionDelegate() view returns (address)',
	'function commitmentIndex() view returns (address)',
	'function feeStreams() view returns (address)',
	'function services() view returns (address)',
	'function ledger() view returns (address)',
	'function repairAuctionDeployer() view returns (address)',
	'function zoltar() view returns (address)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function universeId() view returns (uint248)',
	'function capital() view returns (address)',
	'function forkAuthority() view returns (address)',
	'function engine() view returns (address)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function repairAuctions(uint248 universeId) view returns (address)',
	'function controller() view returns (address)',
	'function bids(uint256 id) view returns (address bidder,address vault,uint256 targetHealthBps,uint256 lots,uint256 minimumAttoRepPerLot,bool settled,bool feesRemoved)',
	'function bidIdForVault(address vault) view returns (uint256)',
	'function finalized() view returns (bool)',
	'function previewBid(uint256 id) view returns ((address bidder,address vault,uint256 targetHealthBps,uint256 filledLots,uint256 usedAttoEth,uint256 principalAttoRep,uint256 refundAttoEth) fill)',
	'function repairAuctionPosition(uint256 bidId) view returns ((address vault,uint96 positionId,uint256 principal,uint256 commitment,uint256 targetHealthFactorBps,uint48 liquidationStarted,bool materialized,uint256 earnedAttoEth,uint256 earnedAttoRep) result)',
])

/** Authenticate compiler runtime and canonical bindings before presenting any funding action. */
export async function loadSecurityPoolBranchAuction(client: ReadClient, securityPool: Address, bidder: Address, universeId: bigint, bidStart = 0n) {
	const snapshot = await loadSecurityPoolAuctionSnapshot({ client: { ...securityPoolReadClient(client), getBalance: parameters => client.getBalance(parameters) }, securityPool, bidder, universeId, bidStart })
	const infrastructure = getInfraContractAddresses()
	if (getAddress(snapshot.factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(snapshot.zoltar) !== getAddress(infrastructure.zoltar)) throw new Error('Security pool uses unrecognized auction infrastructure.')
	const blockNumber = snapshot.blockNumber
	verifyRuntimeCode(await client.getCode({ address: securityPool, blockNumber }), getSecurityPoolRuntimeCode(), securityPoolArtifact.evm.deployedBytecode.immutableReferences, 'securityPool')
	const modules: { address: Address; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }; label: string }[] = [{ address: snapshot.controller, artifact: forkArtifact, label: 'fork coordinator' }]
	const auction = snapshot.auction
	if (auction !== undefined) {
		await verifyAuctionCapitalCustody(client, securityPool, snapshot.capitalLedger, blockNumber)
		await verifyCapitalLedgerClone(client, securityPool, snapshot.capitalLedger, universeId, snapshot.repToken, blockNumber)
		modules.push({ address: auction.address, artifact: auctionArtifact, label: 'security pool auction' }, { address: auction.engine, artifact: engineArtifact, label: 'auction engine' }, { address: auction.vaultImplementation, artifact: vaultArtifact, label: 'auction vault implementation' })
	}
	await Promise.all(modules.map(async module => verifyRuntimeCode(await client.getCode({ address: module.address, blockNumber }), `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)))
	// Every vault is the exact clone the auction creates for the bidder, ledger, auction and bid.
	if (auction !== undefined) await Promise.all(auction.bids.map(async bid => verifyAuctionVaultCode(await client.getCode({ address: bid.vault, blockNumber }), { implementation: auction.vaultImplementation, owner: bidder, capital: snapshot.capitalLedger, auction: auction.address, bidId: bid.id })))
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Auction authentication changed. Refresh and retry.')
	return { ...snapshot, collateral: collateralPresentation(snapshot.collateralToken) }
}

function decodeAuctionBid(value: unknown): SecurityPoolAuctionBid | undefined {
	return decodeStoredValue(value, read => {
		const fill = read.optional('fill', read.record)
		const position = read.optional('position', read.record)
		return {
			id: read.bigint('id'),
			bidder: read.address('bidder'),
			vault: read.address('vault'),
			targetHealthFactorBps: read.bigint('targetHealthFactorBps'),
			lots: read.bigint('lots'),
			minimumAttoRepPerLot: read.bigint('minimumAttoRepPerLot'),
			refundSettled: read.boolean('refundSettled'),
			earlyRefundAttoEth: read.bigint('earlyRefundAttoEth'),
			materialized: read.boolean('materialized'),
			fill: fill && { filledLots: fill.bigint('filledLots'), usedAttoEth: fill.bigint('usedAttoEth'), refundAttoEth: fill.bigint('refundAttoEth'), principalAttoRep: fill.bigint('principalAttoRep') },
			position: position && {
				positionId: position.bigint('positionId'),
				principalAttoRep: position.bigint('principalAttoRep'),
				commitmentAttoEth: position.bigint('commitmentAttoEth'),
				targetHealthFactorBps: position.bigint('targetHealthFactorBps'),
				liquidationStarted: position.bigint('liquidationStarted'),
				materialized: position.boolean('materialized'),
				earnedAttoEth: position.bigint('earnedAttoEth'),
				earnedAttoRep: position.bigint('earnedAttoRep'),
			},
		}
	})
}

export function securityPoolAuctionCache(profile: NetworkProfile, pool: Address, universeId: bigint, bidder: Address, start: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner: bidder, page: `auction:${pool.toLowerCase()}:${start}` }, value => {
		if (!isStoredRecord(value) || !isStoredRecord(value['auction']) || !Array.isArray(value['auction']['bids']) || value['auction']['bids'].length > 16) return undefined
		const bids: SecurityPoolAuctionBid[] = []
		for (const raw of value['auction']['bids']) {
			const bid = decodeAuctionBid(raw)
			if (bid === undefined || bid.bidder.toLowerCase() !== bidder.toLowerCase()) return undefined
			bids.push(bid)
		}
		return decodeStoredValue(value, read => {
			const auction = read.record('auction')
			const clearing = auction.optional('clearing', auction.record)
			return {
				universeId,
				timestamp: read.bigint('timestamp'),
				collateral: collateralPresentation(read.address('collateralToken')),
				collateralAllowance: read.bigint('collateralAllowance'),
				auction: {
					address: auction.address('address'),
					opened: auction.boolean('opened'),
					finalized: auction.boolean('finalized'),
					closesAt: auction.bigint('closesAt'),
					inventoryAttoRep: auction.bigint('inventoryAttoRep'),
					shortfallAttoEth: auction.bigint('shortfallAttoEth'),
					lotAttoEth: auction.bigint('lotAttoEth'),
					minimumCollateralAttoRepPerLot: auction.bigint('minimumCollateralAttoRepPerLot'),
					maximumAdmissibleBidAttoRepPerLot: auction.bigint('maximumAdmissibleBidAttoRepPerLot'),
					repGrid: auction.bigint('repGrid'),
					clearing: clearing && { attoRepPerLot: clearing.bigint('attoRepPerLot') },
					refundAttoEth: auction.bigint('refundAttoEth'),
					bidStart: auction.bigint('bidStart'),
					totalBidCount: auction.bigint('totalBidCount'),
					bids,
				},
			}
		})
	})
}

/** Authenticate one selected vault directly, including its original branch after later forks. */
/**
 * Whether an account's clone-shaped code points at the canonical vault implementation. Any contract can own a position, so
 * a look-alike with another implementation is an ordinary owner rather than a failure; identity errors are the only tolerated ones.
 */
export async function isCanonicalAuctionVaultImplementation(client: ReadClient, implementation: Address, blockNumber: bigint) {
	try {
		verifyRuntimeCode(await client.getCode({ address: implementation, blockNumber }), `0x${vaultArtifact.evm.deployedBytecode.object}`, vaultArtifact.evm.deployedBytecode.immutableReferences, 'auction vault implementation')
		return true
	} catch (error) {
		if (error instanceof Error && ['Unrecognized auction vault implementation runtime code.', 'Inconsistent auction vault implementation immutable values.'].includes(error.message)) return false
		throw error
	}
}

export async function authenticateSecurityPoolAuctionVault(client: ReadClient, securityPool: Address, vault: Address, blockNumber: bigint) {
	const read = (address: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ abi: vaultIdentityAbi, address, functionName, args, blockNumber })
	const vaultCode = await client.getCode({ address: vault, blockNumber })
	const bindings = decodeAuctionVaultBindings(vaultCode)
	if (bindings === undefined) throw new Error('Unrecognized auction vault runtime code.')
	const [ownerValue, capitalValue, auctionValue, idValue, controllerValue, protocolValue, factoryValue] = await Promise.all([
		read(vault, 'owner'),
		read(vault, 'initialCapital'),
		read(vault, 'repairAuction'),
		read(vault, 'bidId'),
		read(securityPool, 'forkController'),
		read(securityPool, 'zoltar'),
		read(securityPool, 'factory'),
	])
	const bidder = requireAddressValue(ownerValue, 'auction vault owner')
	const initialCapital = requireAddressValue(capitalValue, 'initial auction capital')
	const auction = requireAddressValue(auctionValue, 'vault auction')
	const bidId = requireBigintValue(idValue, 'vault bid ID')
	// The clone's code is the only authority for its bindings; the getters must agree with it.
	verifyAuctionVaultCode(vaultCode, { implementation: bindings.implementation, owner: bidder, capital: initialCapital, auction, bidId })
	if (predictAuctionVaultAddress({ implementation: bindings.implementation, owner: bidder, capital: initialCapital, auction, bidId }) !== getAddress(vault)) throw new Error('Auction vault address does not match its bindings.')
	const controller = requireAddressValue(controllerValue, 'fork coordinator')
	const zoltar = requireAddressValue(protocolValue, 'security pool protocol')
	const infrastructure = getInfraContractAddresses()
	if (getAddress(requireAddressValue(factoryValue, 'security pool factory')) !== getAddress(infrastructure.securityPoolFactory) || getAddress(zoltar) !== getAddress(infrastructure.zoltar) || bidId <= 0n) throw new Error('Auction vault uses unrecognized security pool infrastructure.')
	const [universeValue, capitalRoot, capitalProtocol, auctionRoot, auctionCapital, auctionFork, auctionUniverse, engineValue, controllerRoot, implementationValue] = await Promise.all([
		read(initialCapital, 'universeId'),
		read(initialCapital, 'securityPool'),
		read(initialCapital, 'zoltar'),
		read(auction, 'securityPool'),
		read(auction, 'capital'),
		read(auction, 'forkAuthority'),
		read(auction, 'universeId'),
		read(auction, 'engine'),
		read(controller, 'securityPool'),
		read(auction, 'vaultImplementation'),
	])
	const initialUniverse = requireBigintValue(universeValue, 'initial auction universe')
	const engine = requireAddressValue(engineValue, 'auction engine')
	if (getAddress(requireAddressValue(implementationValue, 'vault implementation')) !== bindings.implementation) throw new Error('Auction vault uses another implementation.')
	const [canonicalCapital, canonicalAuction, engineController, bidValue, registeredId] = await Promise.all([read(securityPool, 'capitalLedger', [initialUniverse]), read(controller, 'repairAuctions', [initialUniverse]), read(engine, 'controller'), read(engine, 'bids', [bidId]), read(auction, 'bidIdForVault', [vault])])
	const bid = requireTupleValue(bidValue, 7, 'auction bid')
	if (
		[capitalRoot, auctionRoot, controllerRoot].some(value => getAddress(requireAddressValue(value, 'module security pool')) !== getAddress(securityPool)) ||
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
		throw new Error('Auction vault does not belong to the selected security pool and bidder.')
	await Promise.all([
		client.getCode({ address: securityPool, blockNumber }).then(code => verifyRuntimeCode(code, getSecurityPoolRuntimeCode(), securityPoolArtifact.evm.deployedBytecode.immutableReferences, 'securityPool')),
		...[
			{ address: controller, artifact: forkArtifact, label: 'fork coordinator' },
			{ address: auction, artifact: auctionArtifact, label: 'security pool auction' },
			{ address: engine, artifact: engineArtifact, label: 'auction engine' },
			{ address: bindings.implementation, artifact: vaultArtifact, label: 'auction vault implementation' },
		].map(async module => verifyRuntimeCode(await client.getCode({ address: module.address, blockNumber }), `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)),
	])
	const rep = requireAddressValue(await read(zoltar, 'getRepToken', [initialUniverse]), 'initial universe REP')
	await verifyCapitalLedgerClone(client, securityPool, initialCapital, initialUniverse, rep, blockNumber)
	await verifyAuctionCapitalCustody(client, securityPool, initialCapital, blockNumber)
	const finalized = await read(engine, 'finalized')
	if (typeof finalized !== 'boolean') throw new Error('Invalid auction finalization state.')
	let filledLots = 0n
	let materialized = false
	if (finalized) {
		const fill = requireObjectValue(await read(engine, 'previewBid', [bidId]), 'winning auction fill')
		filledLots = requireBigintValue(Reflect.get(fill, 'filledLots'), 'winning auction lots')
		if (getAddress(requireAddressValue(Reflect.get(fill, 'vault'), 'fill vault')) !== getAddress(vault) || getAddress(requireAddressValue(Reflect.get(fill, 'bidder'), 'fill bidder')) !== getAddress(bidder)) throw new Error('Auction fill identity mismatch.')
		if (filledLots > 0n) {
			const position = requireObjectValue(await read(initialCapital, 'repairAuctionPosition', [bidId]), 'auction position')
			const materializedValue = Reflect.get(position, 'materialized')
			if (getAddress(requireAddressValue(Reflect.get(position, 'vault'), 'position vault')) !== getAddress(vault) || typeof materializedValue !== 'boolean') throw new Error('Invalid auction position identity.')
			materialized = materializedValue
		}
	}
	return { vault: getAddress(vault), bidder: getAddress(bidder), auction: getAddress(auction), initialCapital: getAddress(initialCapital), initialUniverse, bidId, filledLots, materialized }
}

/** Delegate and accounting contracts can spend or mutate deposited capital. */
async function verifyAuctionCapitalCustody(client: ReadClient, securityPool: Address, capitalLedger: Address, blockNumber: bigint) {
	const read = (address: Address, functionName: string) => client.readContract({ abi: vaultIdentityAbi, address, functionName, blockNumber })
	const [lifecycle, repairAuctionDelegate, index, fees, capitalServices, securityPoolServices, deployer] = await Promise.all([
		read(capitalLedger, 'lifecycleDelegate'),
		read(capitalLedger, 'repairAuctionDelegate'),
		read(capitalLedger, 'commitmentIndex'),
		read(capitalLedger, 'feeStreams'),
		read(capitalLedger, 'services'),
		read(securityPool, 'services'),
		read(securityPool, 'repairAuctionDeployer'),
	])
	if (getAddress(requireAddressValue(capitalServices, 'capital services')) !== getAddress(requireAddressValue(securityPoolServices, 'security pool services')) || getAddress(requireAddressValue(deployer, 'auction deployer')) !== getAddress(getInfraContractAddresses().securityPoolRepairAuctionDeployer))
		throw new Error('Auction custody uses another services authority or deployer.')
	const modules = [
		{ value: lifecycle, artifact: lifecycleArtifact, label: 'capital lifecycle delegate', getter: 'implementation', authority: undefined },
		{ value: repairAuctionDelegate, artifact: auctionDelegateArtifact, label: 'capital auction delegate', getter: 'implementation', authority: undefined },
		{ value: securityPoolServices, artifact: servicesArtifact, label: 'security pool services', getter: 'securityPool', authority: securityPool },
	]
	await Promise.all([
		verifyCapitalModuleClone(client, requireAddressValue(index, 'commitment index'), indexArtifact, capitalLedger, 'commitment index', blockNumber),
		verifyCapitalModuleClone(client, requireAddressValue(fees, 'capital fee streams'), feesArtifact, capitalLedger, 'capital fee streams', blockNumber),
		...modules.map(async module => {
			const address = requireAddressValue(module.value, module.label)
			const [code, authority] = await Promise.all([client.getCode({ address, blockNumber }), client.readContract({ abi: module.artifact.abi, address, functionName: module.getter, blockNumber })])
			verifyRuntimeCode(code, `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)
			if (getAddress(requireAddressValue(authority, 'custody module authority')) !== getAddress(module.authority ?? address)) throw new Error(`${module.label} belongs to another authority.`)
		}),
	])
}
