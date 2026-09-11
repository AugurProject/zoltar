import { type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'

import { escalationGameAbi, securityPoolAbi, truthAuctionHaircutAppliedEvent, vaultAccountingCheckpointEvent, vaultEscrowUpdatedEvent } from '@zoltar/bot-shared/contracts/abi'
import { type VaultPosition, repForBackingUnits } from '#core/strategy'
import { type VaultStateIndex, refreshVaultStateIndex } from './vault-state-index.ts'
import { type Address, getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { loadChangedVaultAddresses, type VaultChangeSource } from '#monitoring/vault-change-logs'

export type ReadClient = PublicClient<Transport, Chain>

const MULTICALL3_ADDRESS = getAddress('0xB657B12CD9d80421DBC2bc70c43d6b2ff9409108')

export type PoolMonitorIndex = {
	operatorVaultsByPool: Map<string, VaultPosition>
	vaultsByPool: Map<string, VaultStateIndex<VaultPosition>>
}

export function createPoolMonitorIndex(): PoolMonitorIndex {
	return { operatorVaultsByPool: new Map(), vaultsByPool: new Map() }
}

export function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

function emptyVault(address: Address): VaultPosition {
	return {
		address,
		capacityOwnershipAttoRep: 0n,
		badDebtAttoEth: 0n,
		openInterestAttoEth: 0n,
		backingUnits: 0n,
		vaultAttoRepBacking: 0n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
	}
}

function requireBigint(value: unknown, label: string) {
	if (typeof value !== 'bigint') throw new Error(`Security pool returned invalid ${label}`)
	return value
}

function requireVaultPositionTuple(value: unknown) {
	if (!Array.isArray(value)) throw new Error('Security pool returned invalid vault state')
	return [requireBigint(value[0], 'vault backing units'), requireBigint(value[1], 'vault capacity ownership'), requireBigint(value[2], 'vault claimable fees')] as const
}

export async function loadVaultPage(client: ReadClient, pool: Address, escalationGame: Address, vaultAddresses: readonly Address[], blockNumber: bigint) {
	const [rawVaults, badDebt, disputeStake] = await Promise.all([
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'securityVaults' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'vaultBadDebtAttoEth' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		escalationGame === zeroAddress
			? vaultAddresses.map(() => 0n)
			: client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: escalationGameAbi, address: escalationGame, args: [vault], functionName: 'disputeStakedRepByVaultAttoRep' as const })), multicallAddress: MULTICALL3_ADDRESS }),
	])
	return vaultAddresses.map((address, index) => {
		const raw = rawVaults[index]
		const badDebtAttoEth = badDebt[index]
		const disputeStakedAttoRep = disputeStake[index]
		if (raw === undefined || badDebtAttoEth === undefined || disputeStakedAttoRep === undefined) throw new Error('Security pool returned incomplete vault state')
		const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = requireVaultPositionTuple(raw)
		return {
			address,
			badDebtAttoEth: requireBigint(badDebtAttoEth, 'vault bad debt'),
			capacityOwnershipAttoRep,
			openInterestAttoEth: 0n,
			backingUnits: repBackingUnits,
			vaultAttoRepBacking: 0n,
			claimableFeesAttoEth,
			disputeStakedAttoRep: requireBigint(disputeStakedAttoRep, 'vault dispute stake'),
		}
	})
}

function hasVaultRep(vault: VaultPosition) {
	return vault.backingUnits > 0n || vault.disputeStakedAttoRep > 0n
}

export function currentVaultPositionForPoolAccounting(vault: VaultPosition, totalAttoRep: bigint, denominator: bigint, settlementCollateralAttoEth: bigint, totalCapacityOwnershipAttoRep: bigint): VaultPosition {
	const grossOpenInterestAttoEth = vault.capacityOwnershipAttoRep === 0n || totalCapacityOwnershipAttoRep === 0n ? 0n : (settlementCollateralAttoEth * vault.capacityOwnershipAttoRep + totalCapacityOwnershipAttoRep - 1n) / totalCapacityOwnershipAttoRep
	return {
		...vault,
		openInterestAttoEth: grossOpenInterestAttoEth > vault.badDebtAttoEth ? grossOpenInterestAttoEth - vault.badDebtAttoEth : 0n,
		vaultAttoRepBacking: repForBackingUnits(vault.backingUnits, totalAttoRep, denominator),
	}
}

export async function loadCurrentVaults(
	client: ReadClient,
	index: VaultStateIndex<VaultPosition>,
	pool: Address,
	escalationGame: Address,
	knownVaultCount: bigint,
	totalAttoRep: bigint,
	denominator: bigint,
	settlementCollateralAttoEth: bigint,
	totalCapacityOwnershipAttoRep: bigint,
	block: Readonly<{ hash: `0x${string}`; number: bigint }>,
) {
	const refresh = await refreshVaultStateIndex(index, {
		block,
		hasRep: hasVaultRep,
		knownVaultCount,
		loadChangedVaultAddresses: async (fromBlock, toBlock) => {
			const sources: VaultChangeSource[] = [async range => await client.getLogs({ address: pool, event: vaultAccountingCheckpointEvent, fromBlock: range.fromBlock, toBlock: range.toBlock })]
			if (escalationGame === zeroAddress) return await loadChangedVaultAddresses(fromBlock, toBlock, sources)
			sources.push(async range => await client.getLogs({ address: escalationGame, event: vaultEscrowUpdatedEvent, fromBlock: range.fromBlock, toBlock: range.toBlock }))
			const haircutSources: VaultChangeSource[] = [async range => await client.getLogs({ address: escalationGame, event: truthAuctionHaircutAppliedEvent, fromBlock: range.fromBlock, toBlock: range.toBlock })]
			const disputeStakedVaults = [...index.activeVaults.values()].filter(vault => vault.disputeStakedAttoRep > 0n).map(vault => vault.address)
			return await loadChangedVaultAddresses(fromBlock, toBlock, sources, haircutSources, disputeStakedVaults)
		},
		loadPositions: async vaults => await loadVaultPage(client, pool, escalationGame, vaults, block.number),
		loadRegistryRange: async (start, count) => {
			const page = await client.readContract({ abi: securityPoolAbi, address: pool, args: [start, count], blockNumber: block.number, functionName: 'getVaults' })
			return page.map(address => getAddress(address))
		},
		readCanonicalBlockHash: async blockNumber => (await client.getBlock({ blockNumber })).hash,
	})
	index.activeVaults = new Map(
		refresh.activeVaults.map(vault => {
			const current = currentVaultPositionForPoolAccounting(vault, totalAttoRep, denominator, settlementCollateralAttoEth, totalCapacityOwnershipAttoRep)
			return [current.address.toLowerCase(), current]
		}),
	)
	return {
		refreshedVaults: refresh.refreshedVaults.map(vault => currentVaultPositionForPoolAccounting(vault, totalAttoRep, denominator, settlementCollateralAttoEth, totalCapacityOwnershipAttoRep)),
		reset: refresh.reset,
		vaults: [...index.activeVaults.values()],
	}
}

export async function resolveOperatorVault(
	monitorIndex: PoolMonitorIndex,
	pool: Address,
	wallet: Address | undefined,
	refresh: Awaited<ReturnType<typeof loadCurrentVaults>>,
	accounting: Readonly<{ denominator: bigint; settlementCollateralAttoEth: bigint; totalAttoRep: bigint; totalCapacityOwnershipAttoRep: bigint }>,
	loadPosition: (wallet: Address) => Promise<VaultPosition>,
) {
	const poolKey = pool.toLowerCase()
	if (wallet === undefined) {
		monitorIndex.operatorVaultsByPool.delete(poolKey)
		return emptyVault(zeroAddress)
	}
	const refreshed = refresh.refreshedVaults.find(vault => sameAddress(vault.address, wallet))
	const active = refresh.vaults.find(vault => sameAddress(vault.address, wallet))
	const cached = monitorIndex.operatorVaultsByPool.get(poolKey)
	let position = refreshed ?? active
	if (position === undefined) {
		if (refresh.reset) position = emptyVault(wallet)
		else if (cached !== undefined && sameAddress(cached.address, wallet)) position = cached
		else position = await loadPosition(wallet)
	}
	const current = currentVaultPositionForPoolAccounting(position, accounting.totalAttoRep, accounting.denominator, accounting.settlementCollateralAttoEth, accounting.totalCapacityOwnershipAttoRep)
	monitorIndex.operatorVaultsByPool.set(poolKey, current)
	return current
}
