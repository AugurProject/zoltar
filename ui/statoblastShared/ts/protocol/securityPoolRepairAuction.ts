import { auctionErrors, contractLinkMismatch } from '../copy/protocolErrors.js'
import { collateralPresentation } from './collateral.js'
import { getAddress, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { loadSecurityPoolAuctionClaimableBidIds, loadSecurityPoolAuctionSnapshot, type SecurityPoolAuctionBid } from '@zoltar/statoblast-shared/statoblast/securityPool'
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
} from '../contractArtifact.js'
import { getInfraContractAddresses, getSecurityPoolRuntimeCode } from './deploymentHelpers.js'
import { securityPoolReadClient, verifyCapitalLedgerClone, verifyCapitalModuleClone, verifyRuntimeCode } from './securityPool.js'
import { requireAddressValue } from './decoders.js'

const custodyAbi = parseAbi([
	'function lifecycleDelegate() view returns (address)',
	'function repairAuctionDelegate() view returns (address)',
	'function commitmentIndex() view returns (address)',
	'function feeStreams() view returns (address)',
	'function services() view returns (address)',
	'function repairAuctionDeployer() view returns (address)',
])

/** Authenticate compiler runtime and canonical bindings before presenting any funding action. */
export async function loadSecurityPoolBranchAuction(client: ReadClient, securityPool: Address, bidder: Address, universeId: bigint, bidStart = 0n) {
	const auctionClient = { ...securityPoolReadClient(client), getBalance: (parameters: { address: Address; blockNumber: bigint }) => client.getBalance(parameters) }
	const snapshot = await loadSecurityPoolAuctionSnapshot({ client: auctionClient, securityPool, bidder, universeId, bidStart })
	const infrastructure = getInfraContractAddresses()
	if (getAddress(snapshot.factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(snapshot.zoltar) !== getAddress(infrastructure.zoltar)) throw new Error(auctionErrors.auctionNotVerified)
	const blockNumber = snapshot.blockNumber
	verifyRuntimeCode(await client.getCode({ address: securityPool, blockNumber }), getSecurityPoolRuntimeCode(), securityPoolArtifact.evm.deployedBytecode.immutableReferences, 'securityPool')
	const modules: { address: Address; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }; label: string }[] = [{ address: snapshot.controller, artifact: forkArtifact, label: 'fork contract' }]
	const auction = snapshot.auction
	if (auction !== undefined) {
		await verifyAuctionCapitalCustody(client, securityPool, snapshot.capitalLedger, blockNumber)
		await verifyCapitalLedgerClone(client, securityPool, snapshot.capitalLedger, universeId, snapshot.repToken, blockNumber)
		modules.push({ address: auction.address, artifact: auctionArtifact, label: 'security pool auction' }, { address: auction.engine, artifact: engineArtifact, label: 'auction bidding contract' })
	}
	await Promise.all(modules.map(async module => verifyRuntimeCode(await client.getCode({ address: module.address, blockNumber }), `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)))
	// Every bid of this bidder that can be claimed now, on any page, for one claim-all transaction.
	const claimableBidIds = await loadSecurityPoolAuctionClaimableBidIds(auctionClient, snapshot)
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error(auctionErrors.auctionChanged)
	return { ...snapshot, claimableBidIds, collateral: collateralPresentation(snapshot.collateralToken) }
}

function decodeAuctionBid(value: unknown): SecurityPoolAuctionBid | undefined {
	return decodeStoredValue(value, read => {
		const fill = read.optional('fill', read.record)
		const position = read.optional('position', read.record)
		return {
			id: read.bigint('id'),
			bidder: read.address('bidder'),
			lots: read.bigint('lots'),
			minimumAttoRepPerLot: read.bigint('minimumAttoRepPerLot'),
			refundSettled: read.boolean('refundSettled'),
			earlyRefundAttoEth: read.bigint('earlyRefundAttoEth'),
			claimable: read.boolean('claimable'),
			claimed: read.boolean('claimed'),
			materialized: read.boolean('materialized'),
			fill: fill && { filledLots: fill.bigint('filledLots'), usedAttoEth: fill.bigint('usedAttoEth'), refundAttoEth: fill.bigint('refundAttoEth'), principalAttoRep: fill.bigint('principalAttoRep') },
			position: position && {
				principalAttoRep: position.bigint('principalAttoRep'),
				commitmentAttoEth: position.bigint('commitmentAttoEth'),
				liquidationStarted: position.bigint('liquidationStarted'),
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
					clearing: clearing && { attoRepPerLot: clearing.bigint('attoRepPerLot'), filledLots: clearing.optional('filledLots', clearing.bigint) },
					bidStart: auction.bigint('bidStart'),
					totalBidCount: auction.bigint('totalBidCount'),
					unclaimedBidCount: auction.bigint('unclaimedBidCount'),
					bids,
				},
			}
		})
	})
}

/** Delegate and accounting contracts can spend or mutate deposited capital. */
async function verifyAuctionCapitalCustody(client: ReadClient, securityPool: Address, capitalLedger: Address, blockNumber: bigint) {
	const read = (address: Address, functionName: string) => client.readContract({ abi: custodyAbi, address, functionName, blockNumber })
	const [lifecycle, repairAuctionDelegate, index, fees, capitalServices, securityPoolServices, deployer] = await Promise.all([
		read(capitalLedger, 'lifecycleDelegate'),
		read(capitalLedger, 'repairAuctionDelegate'),
		read(capitalLedger, 'commitmentIndex'),
		read(capitalLedger, 'feeStreams'),
		read(capitalLedger, 'services'),
		read(securityPool, 'services'),
		read(securityPool, 'repairAuctionDeployer'),
	])
	if (getAddress(requireAddressValue(capitalServices, 'pool operations address')) !== getAddress(requireAddressValue(securityPoolServices, 'pool operations contract')) || getAddress(requireAddressValue(deployer, 'auction setup contract')) !== getAddress(getInfraContractAddresses().securityPoolRepairAuctionDeployer))
		throw new Error(auctionErrors.collateralContractMismatch)
	const modules = [
		{ value: lifecycle, artifact: lifecycleArtifact, label: 'pool setup contract', getter: 'implementation', authority: undefined },
		{ value: repairAuctionDelegate, artifact: auctionDelegateArtifact, label: 'pool auction contract', getter: 'implementation', authority: undefined },
		{ value: securityPoolServices, artifact: servicesArtifact, label: 'pool operations contract', getter: 'securityPool', authority: securityPool },
	]
	await Promise.all([
		verifyCapitalModuleClone(client, requireAddressValue(index, 'pool capacity contract'), indexArtifact, capitalLedger, 'pool capacity contract', blockNumber),
		verifyCapitalModuleClone(client, requireAddressValue(fees, 'pool fees contract'), feesArtifact, capitalLedger, 'pool fees contract', blockNumber),
		...modules.map(async module => {
			const address = requireAddressValue(module.value, module.label)
			const [code, authority] = await Promise.all([client.getCode({ address, blockNumber }), client.readContract({ abi: module.artifact.abi, address, functionName: module.getter, blockNumber })])
			verifyRuntimeCode(code, `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)
			if (getAddress(requireAddressValue(authority, 'contract linked to auction collateral')) !== getAddress(module.authority ?? address)) throw new Error(contractLinkMismatch(module.label))
		}),
	])
}
