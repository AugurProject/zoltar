import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { currentVaultPositionForPoolAccounting, loadChangedVaultAddresses } from '#monitoring/pool-monitor'

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
