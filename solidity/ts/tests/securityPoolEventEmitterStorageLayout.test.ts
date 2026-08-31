import { test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from '../testSupport/simulator/utils/assert'
import { getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

test('SecurityPool event delegate storage anchors match the host layout', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const layout = normalizeStorageLayout(getContractOutput(artifacts, 'contracts/statoblast/SecurityPool.sol', 'SecurityPool'))
	const expectedSlots = new Map<string, string>([
		['totalCapacityOwnershipAttoRep', '1'],
		['settlementCollateralAttoEth', '2'],
		['totalRepBackingUnits', '3'],
		['totalClaimableVaultFeesAttoEth', '6'],
		['lastUpdatedFeeAccumulator', '7'],
		['feeIndex', '8'],
		['feeIndexRemainder', '9'],
		['totalFeesOwedRemainder', '10'],
		['unallocatedAccruedFeesAttoEth', '11'],
		['feeEligibleCapacityOwnershipAttoRep', '12'],
		['uncheckpointedFeeEligibleCapacityOwnershipAttoRep', '13'],
		['currentRetentionRate', '14'],
		['securityVaults', '16'],
		['vaultFeeRemainders', '17'],
		['lastDepositTargetHealthFactorBpsByVault', '25'],
	])
	for (const [label, expectedSlot] of expectedSlots) {
		const entry = layout.find(candidate => candidate.label === label)
		if (entry === undefined) throw new Error(`SecurityPool storage layout is missing ${label}`)
		assert.strictEqual(entry.slot, expectedSlot, `${label} moved from the slot read by SecurityPoolEventEmitter`)
		assert.strictEqual(entry.offset, 0, `${label} is no longer word-aligned for SecurityPoolEventEmitter`)
	}
	const vaultsEntry = layout.find(entry => entry.label === 'securityVaults')
	if (vaultsEntry === undefined) throw new Error('SecurityPool storage layout is missing securityVaults')
	if (!('value' in vaultsEntry.type)) throw new Error('securityVaults storage type has no value definition')
	const value = vaultsEntry.type.value
	if (typeof value !== 'object' || value === null || !('members' in value) || !Array.isArray(value.members)) {
		throw new Error('securityVaults storage type has no member layout')
	}
	assert.deepStrictEqual(
		value.members.map((member, index) => {
			const memberRecord = getRecord(member, `Invalid securityVaults member ${index}`)
			if (typeof memberRecord.offset !== 'number') throw new Error(`Missing offset for securityVaults member ${index}`)
			return {
				label: getString(memberRecord.label, `Missing label for securityVaults member ${index}`),
				slot: getString(memberRecord.slot, `Missing slot for securityVaults member ${index}`),
				offset: memberRecord.offset,
			}
		}),
		[
			{ label: 'repBackingUnits', slot: '0', offset: 0 },
			{ label: 'capacityOwnershipAttoRep', slot: '1', offset: 0 },
			{ label: 'claimableFeesAttoEth', slot: '2', offset: 0 },
			{ label: 'feeIndex', slot: '3', offset: 0 },
		],
	)
})

test('SecurityPool stateful delegates retain the exact host storage sequence', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const hostLayout = normalizeStorageLayout(getContractOutput(artifacts, 'contracts/statoblast/SecurityPool.sol', 'SecurityPool'))
	const summarize = (layout: typeof hostLayout) =>
		layout.map(entry => ({
			label: entry.label,
			offset: entry.offset,
			slot: entry.slot,
			type: entry.type,
		}))
	for (const [sourcePath, contractName] of [
		['contracts/statoblast/SecurityPoolSettlementDelegate.sol', 'SecurityPoolSettlementDelegate'],
		['contracts/statoblast/SecurityPoolLiquidationDelegate.sol', 'SecurityPoolLiquidationDelegate'],
	] as const) {
		const delegateLayout = normalizeStorageLayout(getContractOutput(artifacts, sourcePath, contractName))
		assert.deepStrictEqual(summarize(delegateLayout), summarize(hostLayout), `${contractName} storage layout diverged`)
	}
})

test('SecurityPool keeps low-level assembly outside the stateful host contract', () => {
	const securityPoolSource = readFileSync(join(import.meta.dir, '../../contracts/statoblast/SecurityPool.sol'), 'utf8')
	assert.strictEqual(securityPoolSource.match(/\bassembly\b/), null)
})
