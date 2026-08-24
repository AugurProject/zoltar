import { expect, test } from 'bun:test'
import { isUnsafeVault, PRICE_PRECISION, type VaultPosition } from '#core/strategy'
import { createPoolMonitorIndex, currentVaultPositionForPoolAccounting, loadChangedVaultAddresses, resolveOperatorVault } from '#monitoring/pool-monitor'
import { createVaultStateIndex, refreshVaultStateIndex } from '#monitoring/vault-state-index'
import { getAddress } from '../helpers/ethereum.ts'

const vault = getAddress('0x0000000000000000000000000000000000000001')
const escrowVault = getAddress('0x0000000000000000000000000000000000000002')

test('vault checkpoint catch-up adapts long cursor gaps into bounded ordered ranges', async () => {
	const completedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
	const addresses = await loadChangedVaultAddresses(0n, 20_000n, [
		async range => {
			if (range.toBlock - range.fromBlock + 1n > 2_500n) throw new Error('block range is too large')
			completedRanges.push(range)
			return range.fromBlock === 0n ? [{ args: { vault } }] : []
		},
	])

	expect(addresses).toEqual([vault])
	expect(completedRanges[0]?.fromBlock).toBe(0n)
	expect(completedRanges.at(-1)?.toBlock).toBe(20_000n)
	for (let index = 1; index < completedRanges.length; index++) {
		expect(completedRanges[index]?.fromBlock).toBe((completedRanges[index - 1]?.toBlock ?? -1n) + 1n)
	}
})

test('vault change discovery includes pool checkpoints and escalation escrow updates', async () => {
	const addresses = await loadChangedVaultAddresses(10n, 10n, [async () => [{ args: { vault } }], async () => [{ args: { vault: escrowVault } }]])
	expect(addresses).toEqual([vault, escrowVault])
})

test('a truth-auction haircut globally dirties every retained dispute-staked vault', async () => {
	const backing = (15n * PRICE_PRECISION) / 10n
	const initialStake = PRICE_PRECISION / 2n
	const haircuttedStake = (2n * PRICE_PRECISION) / 5n
	const position = (address: typeof vault, disputeStakedAttoRep: bigint): VaultPosition => ({
		address,
		backingUnits: backing,
		badDebtAttoEth: 0n,
		capacityOwnershipAttoRep: PRICE_PRECISION,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep,
		openInterestAttoEth: PRICE_PRECISION,
		vaultAttoRepBacking: backing,
	})
	const positions = new Map([
		[vault.toLowerCase(), position(vault, initialStake)],
		[escrowVault.toLowerCase(), position(escrowVault, initialStake)],
	])
	const index = createVaultStateIndex<VaultPosition>()
	const loadPositions = async (addresses: readonly (typeof vault)[]) => addresses.map(address => positions.get(address.toLowerCase()) ?? position(address, 0n))
	const first = await refreshVaultStateIndex(index, {
		block: { hash: `0x${'11'.repeat(32)}`, number: 9n },
		hasRep: candidate => candidate.backingUnits > 0n || candidate.disputeStakedAttoRep > 0n,
		knownVaultCount: 2n,
		loadChangedVaultAddresses: async () => [],
		loadPositions,
		loadRegistryRange: async () => [vault, escrowVault],
		readCanonicalBlockHash: async () => `0x${'11'.repeat(32)}`,
	})
	expect(first.activeVaults.every(candidate => !isUnsafeVault(candidate.vaultAttoRepBacking, candidate.openInterestAttoEth, 20_000n, PRICE_PRECISION, candidate.disputeStakedAttoRep))).toBeTrue()
	positions.set(vault.toLowerCase(), position(vault, haircuttedStake))
	positions.set(escrowVault.toLowerCase(), position(escrowVault, haircuttedStake))

	const second = await refreshVaultStateIndex(index, {
		block: { hash: `0x${'22'.repeat(32)}`, number: 10n },
		hasRep: candidate => candidate.backingUnits > 0n || candidate.disputeStakedAttoRep > 0n,
		knownVaultCount: 2n,
		loadChangedVaultAddresses: async (fromBlock, toBlock) =>
			await loadChangedVaultAddresses(
				fromBlock,
				toBlock,
				[async () => []],
				[async () => [{ args: { repRemovedAttoRep: 1n } }]],
				[...index.activeVaults.values()].filter(candidate => candidate.disputeStakedAttoRep > 0n).map(candidate => candidate.address),
			),
		loadPositions,
		loadRegistryRange: async () => [],
		readCanonicalBlockHash: async blockNumber => (blockNumber === 9n ? `0x${'11'.repeat(32)}` : `0x${'22'.repeat(32)}`),
	})

	expect(second.refreshedVaults.map(candidate => candidate.address)).toEqual([vault, escrowVault])
	expect(second.activeVaults.every(candidate => candidate.disputeStakedAttoRep === haircuttedStake)).toBeTrue()
	expect(second.activeVaults.every(candidate => isUnsafeVault(candidate.vaultAttoRepBacking, candidate.openInterestAttoEth, 20_000n, PRICE_PRECISION, candidate.disputeStakedAttoRep))).toBeTrue()
})

test('cached raw vault state recomputes backing and open interest from current pool accounting', () => {
	const raw = {
		address: vault,
		backingUnits: 2n,
		badDebtAttoEth: 1n,
		capacityOwnershipAttoRep: 3n,
		claimableFeesAttoEth: 4n,
		disputeStakedAttoRep: 5n,
		openInterestAttoEth: 0n,
		vaultAttoRepBacking: 0n,
	}

	expect(currentVaultPositionForPoolAccounting(raw, 100n, 10n, 101n, 10n)).toMatchObject({ openInterestAttoEth: 30n, vaultAttoRepBacking: 20n })
	expect(currentVaultPositionForPoolAccounting(raw, 200n, 10n, 201n, 10n)).toMatchObject({ openInterestAttoEth: 60n, vaultAttoRepBacking: 40n })
})

test('unchanged empty operator vaults are read once and then served from the event-aware cache', async () => {
	const pool = getAddress('0x0000000000000000000000000000000000000003')
	const operator = getAddress('0x0000000000000000000000000000000000000004')
	const monitorIndex = createPoolMonitorIndex()
	const emptyOperator = {
		address: operator,
		backingUnits: 0n,
		badDebtAttoEth: 0n,
		capacityOwnershipAttoRep: 0n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
		openInterestAttoEth: 0n,
		vaultAttoRepBacking: 0n,
	}
	const refresh = { refreshedVaults: [], reset: false, vaults: [] }
	const accounting = { denominator: 10n, settlementCollateralAttoEth: 100n, totalAttoRep: 100n, totalCapacityOwnershipAttoRep: 10n }
	let positionReads = 0
	const loadPosition = async () => {
		positionReads += 1
		return emptyOperator
	}

	await resolveOperatorVault(monitorIndex, pool, operator, refresh, accounting, loadPosition)
	await resolveOperatorVault(monitorIndex, pool, operator, refresh, accounting, loadPosition)

	expect(positionReads).toBe(1)
})
