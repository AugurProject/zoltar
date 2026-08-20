import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

function getForkerStorageLayout(artifacts: Record<string, unknown>, sourcePath: string, contractName: string) {
	return normalizeStorageLayout(getContractOutput(artifacts, sourcePath, contractName))
}

test('SecurityPoolForker retains unified own-fork fields in fork session storage', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const forkerLayout = getForkerStorageLayout(artifacts, 'contracts/statoblast/SecurityPoolForker.sol', 'SecurityPoolForker')
	const forkDataByPoolEntry = forkerLayout.find(entry => entry.label === 'forkDataByPool')
	if (forkDataByPoolEntry === undefined) throw new Error('Storage layout missing forkDataByPool field')
	const forkDataByPoolValueType = getRecord(forkDataByPoolEntry.type.value, 'Storage layout missing forkDataByPool value type')
	const forkDataMembers = getArray(forkDataByPoolValueType.members, 'Storage layout missing forkDataByPool value members')
	const forkDataLabels = new Set(forkDataMembers.map(member => getString(getRecord(member, 'Invalid forkDataByPool member').label, 'Missing member label for forkDataByPool struct type')))
	assert.ok(forkDataLabels.has('vaultRepAtForkAttoRep'))
	assert.ok(forkDataLabels.has('escalationChildRepAtForkAttoRep'))
	assert.ok(forkDataLabels.has('escalationSourceRepAtForkAttoRep'))
	const unassignedBackingMember = forkDataMembers.map(member => getRecord(member, 'Invalid forkDataByPool member')).find(member => member.label === 'unassignedRepBackingUnitsAtFinalization')
	if (unassignedBackingMember === undefined) throw new Error('Storage layout missing unassigned REP backing field')
	assert.strictEqual(unassignedBackingMember.slot, '28')
})

test('SecurityPoolForker delegates keep the exact host storage layout', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const hostLayout = getForkerStorageLayout(artifacts, 'contracts/statoblast/SecurityPoolForker.sol', 'SecurityPoolForker')
	const vaultMigrationDelegateLayout = getForkerStorageLayout(artifacts, 'contracts/statoblast/SecurityPoolForkerVaultMigrationDelegate.sol', 'SecurityPoolForkerVaultMigrationDelegate')
	const escalationGameForkerLayout = getForkerStorageLayout(artifacts, 'contracts/statoblast/EscalationGameForker.sol', 'EscalationGameForker')

	assert.deepStrictEqual(vaultMigrationDelegateLayout, hostLayout)
	assert.deepStrictEqual(escalationGameForkerLayout, hostLayout)
})
