import { test } from 'bun:test'
import assert from '../testsuite/simulator/utils/assert'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

test('SecurityPoolForker retains unified own-fork fields in fork session storage', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const forkerLayout = normalizeStorageLayout(getContractOutput(artifacts, 'contracts/peripherals/SecurityPoolForker.sol', 'SecurityPoolForker'))
	const forkDataByPoolEntry = forkerLayout.find(entry => entry.label === 'forkDataByPool')
	if (forkDataByPoolEntry === undefined) throw new Error('Storage layout missing forkDataByPool field')
	const forkDataByPoolValueType = getRecord(forkDataByPoolEntry.type.value, 'Storage layout missing forkDataByPool value type')
	const forkDataMembers = getArray(forkDataByPoolValueType.members, 'Storage layout missing forkDataByPool value members')
	const forkDataLabels = new Set(forkDataMembers.map(member => getString(getRecord(member, 'Invalid forkDataByPool member').label, 'Missing member label for forkDataByPool struct type')))
	assert.ok(forkDataLabels.has('vaultRepAtFork'))
	assert.ok(forkDataLabels.has('escalationChildRepAtFork'))
	assert.ok(forkDataLabels.has('escalationSourceRepAtFork'))
})
