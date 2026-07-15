import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

function getForkerStorageLayout(artifacts: Record<string, unknown>, sourcePath: string, contractName: string) {
	return normalizeStorageLayout(getContractOutput(artifacts, sourcePath, contractName))
}

test('SecurityPoolForker retains unified own-fork fields in fork session storage', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const forkerLayout = getForkerStorageLayout(artifacts, 'contracts/peripherals/SecurityPoolForker.sol', 'SecurityPoolForker')
	const forkDataByPoolEntry = forkerLayout.find(entry => entry.label === 'forkDataByPool')
	if (forkDataByPoolEntry === undefined) throw new Error('Storage layout missing forkDataByPool field')
	const forkDataByPoolValueType = getRecord(forkDataByPoolEntry.type.value, 'Storage layout missing forkDataByPool value type')
	const forkDataMembers = getArray(forkDataByPoolValueType.members, 'Storage layout missing forkDataByPool value members')
	const forkDataLabels = new Set(forkDataMembers.map(member => getString(getRecord(member, 'Invalid forkDataByPool member').label, 'Missing member label for forkDataByPool struct type')))
	assert.ok(forkDataLabels.has('vaultRepAtFork'))
	assert.ok(forkDataLabels.has('escalationChildRepAtFork'))
	assert.ok(forkDataLabels.has('escalationSourceRepAtFork'))
})

test('SecurityPoolForker delegates keep the exact host storage layout', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const hostLayout = getForkerStorageLayout(artifacts, 'contracts/peripherals/SecurityPoolForker.sol', 'SecurityPoolForker')
	const vaultMigrationDelegateLayout = getForkerStorageLayout(artifacts, 'contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol', 'SecurityPoolForkerVaultMigrationDelegate')
	const escalationGameForkerLayout = getForkerStorageLayout(artifacts, 'contracts/peripherals/EscalationGameForker.sol', 'EscalationGameForker')

	assert.deepStrictEqual(vaultMigrationDelegateLayout, hostLayout)
	assert.deepStrictEqual(escalationGameForkerLayout, hostLayout)
})
