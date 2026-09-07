import { test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from '../testSupport/simulator/utils/assert'
import { getContractOutput, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

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
		['contracts/statoblast/SecurityPoolEventEmitter.sol', 'SecurityPoolEventEmitter'],
		['contracts/statoblast/SecurityPoolSettlementDelegate.sol', 'SecurityPoolSettlementDelegate'],
		['contracts/statoblast/SecurityPoolOperationsDelegate.sol', 'SecurityPoolOperationsDelegate'],
	] as const) {
		const delegateLayout = normalizeStorageLayout(getContractOutput(artifacts, sourcePath, contractName))
		assert.deepStrictEqual(summarize(delegateLayout), summarize(hostLayout), `${contractName} storage layout diverged`)
	}
})

test('SecurityPool keeps low-level assembly outside the stateful host contract', () => {
	const securityPoolSource = readFileSync(join(import.meta.dir, '../../contracts/statoblast/SecurityPool.sol'), 'utf8')
	assert.strictEqual(securityPoolSource.match(/\bassembly\b/), null)
})
