import { collateralPresentation } from './collateral.js'
import { getAddress, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { loadSecurityPoolAuctionClaimableBidIds, loadSecurityPoolAuctionSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
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
	if (getAddress(snapshot.factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(snapshot.zoltar) !== getAddress(infrastructure.zoltar)) throw new Error('Security pool uses unrecognized auction infrastructure.')
	const blockNumber = snapshot.blockNumber
	verifyRuntimeCode(await client.getCode({ address: securityPool, blockNumber }), getSecurityPoolRuntimeCode(), securityPoolArtifact.evm.deployedBytecode.immutableReferences, 'securityPool')
	const modules: { address: Address; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }; label: string }[] = [{ address: snapshot.controller, artifact: forkArtifact, label: 'fork coordinator' }]
	const auction = snapshot.auction
	if (auction !== undefined) {
		await verifyAuctionCapitalCustody(client, securityPool, snapshot.capitalLedger, blockNumber)
		await verifyCapitalLedgerClone(client, securityPool, snapshot.capitalLedger, universeId, snapshot.repToken, blockNumber)
		modules.push({ address: auction.address, artifact: auctionArtifact, label: 'security pool auction' }, { address: auction.engine, artifact: engineArtifact, label: 'auction engine' })
	}
	await Promise.all(modules.map(async module => verifyRuntimeCode(await client.getCode({ address: module.address, blockNumber }), `0x${module.artifact.evm.deployedBytecode.object}`, module.artifact.evm.deployedBytecode.immutableReferences, module.label)))
	// Every bid of this bidder that can be claimed now, on any page, for one claim-all transaction.
	const claimableBidIds = await loadSecurityPoolAuctionClaimableBidIds(auctionClient, snapshot)
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Auction authentication changed. Refresh and retry.')
	return { ...snapshot, claimableBidIds, collateral: collateralPresentation(snapshot.collateralToken) }
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
