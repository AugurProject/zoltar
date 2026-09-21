import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfiguration } from '#config/configuration'
import { parseOperatorSettings, saveOperatorSettings } from '#config/settings-store'
import type { OperatorState } from '#state/operator-state'
import example from '../../config/operator.example.json'
import { createDeploymentRecoveryReconciliation } from '../../src/runtime/deployment-recovery.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

test('does not probe placeholder endpoints for a reconciled journal while the chain is unconfigured', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-recovery-'))
	temporaryDirectories.push(directory)
	const settingsFile = join(directory, 'operator.json')
	await saveOperatorSettings(settingsFile, parseOperatorSettings({ ...example, connectivity: undefined, networkConfigured: false, runtime: { ...example.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') } }))
	const config = await loadConfiguration(settingsFile)
	expect(config.networkConfigured).toBe(false)
	const state: Pick<OperatorState, 'canonicalDeployments' | 'operationLog'> = { canonicalDeployments: undefined, operationLog: [] }
	const reconciliation = createDeploymentRecoveryReconciliation({
		config,
		readClients: () => {
			throw new Error('An unconfigured operator must not read the chain')
		},
		state,
	})
	expect(await reconciliation.verifyExecutorDeployed()).toBe(false)
	expect(state.canonicalDeployments).toBeUndefined()
	// Configuring the chain is read at call time, so the same reconciliation starts verifying once the operator is configured.
	config.networkConfigured = true
	await expect(reconciliation.verifyExecutorDeployed()).rejects.toThrow('An unconfigured operator must not read the chain')
	reconciliation.onReconciled(`0x${'44'.repeat(32)}`)
	expect(state.operationLog.map(entry => [entry.level, entry.message, entry.details])).toEqual([['info', 'Executor deployment recovery reconciled externally', `0x${'44'.repeat(32)}`]])
})
