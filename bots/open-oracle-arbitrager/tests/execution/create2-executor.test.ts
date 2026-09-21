import { expect, test } from 'bun:test'
import { deployExecutorCreate2 } from '#execution/create2-executor'
import { assertExecutorDeploymentActive, assertExecutorDeploymentEnvironment, assertExecutorDeploymentIntent, assertExecutorDeploymentReceipt, deterministicDeploymentProxy, executorCodeStatus, executorDeploymentPlan, submitExecutorDeploymentTransaction } from '#execution/executor-deployment-primitives'

// Runtime bytecode of the canonical deterministic deployment proxy (Arachnid's CREATE2 factory).
const deterministicDeploymentProxyCode = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3' as const
import { executorArtifact } from '#contracts/artifacts.generated'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { keccak256, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import type { Hex } from '@zoltar/bot-shared/ethereum'
import { deployExecutorFromConnectivity, requireActivePersistedNetwork, requireActivePersistedRpcQuorum, requireNoPendingExecutorDeployment, requirePausedExecutorDeployment } from '../../src/runtime/executor-deployment-control.ts'
import { acquireScanSignerOperation, clearDeploymentRecovery, executorDeploymentRecoveryStatus, persistExecutorDeploymentIntentForRecovery, type DeploymentRecoveryState } from '../../src/runtime/signer-operations.ts'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { acquireExecutorDeploymentIntentLock, clearExecutorDeploymentIntent, executorDeploymentIntentPath, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent, type ExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { acquireExecutionSignerLock } from '#state/position-store'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Builds the shared recovery state without letting TypeScript narrow it to the initial member, since the helpers reassign it in place. */
function deploymentRecoveryState(initial: DeploymentRecoveryState = { pending: false }): DeploymentRecoveryState {
	return { ...initial }
}

test('rejects executor deployment while a different saved network is pending', () => {
	expect(() => requireActivePersistedNetwork('mainnet', 'sepolia')).toThrow('Wait for the saved network to apply at the next scan boundary')
	expect(() => requireActivePersistedNetwork('mainnet', 'mainnet')).not.toThrow()
})

test('rejects executor deployment while a different saved RPC quorum is pending', () => {
	expect(() => requireActivePersistedRpcQuorum(1, 2)).toThrow('Wait for the saved RPC agreement requirement to apply at the next scan boundary')
	expect(() => requireActivePersistedRpcQuorum(2, 2)).not.toThrow()
})

test('rechecks execution pause immediately before executor deployment', () => {
	expect(() => requirePausedExecutorDeployment(true, false)).toThrow('Pause execution before deploying')
	expect(() => requirePausedExecutorDeployment(true, true)).not.toThrow()
})

test('rechecks shutdown immediately before executor deployment broadcast', () => {
	expect(() => assertExecutorDeploymentActive(() => false)).not.toThrow()
	expect(() => assertExecutorDeploymentActive(() => true)).toThrow('Operator stopping before executor deployment submission')
})

test('derives a stable executor address and canonical proxy calldata from a bytes32 salt', () => {
	const salt = `0x${'00'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	expect(deterministicDeploymentProxy).toBe('0x4e59b44847b379578588920cA78FbF26c0B4956C')
	expect(plan.address).toBe('0x5D35D34367322271BB3deAE3fAce338ca1D3201b')
	expect(plan.salt).toBe(salt)
	expect(plan.calldata).toBe(`${salt}${plan.bytecode.slice(2)}` as Hex)
})

test('rejects salts that cannot make CREATE2 deployment deterministic', () => {
	expect(() => executorDeploymentPlan('hello')).toThrow('32-byte')
	expect(() => executorDeploymentPlan(`0x${'00'.repeat(31)}`)).toThrow('32-byte')
})

test('fails closed on a wrong chain or unexpected canonical proxy runtime', () => {
	expect(() => assertExecutorDeploymentEnvironment(1, 11_155_111, deterministicDeploymentProxyCode)).toThrow('RPC chain mismatch')
	expect(() => assertExecutorDeploymentEnvironment(11_155_111, 11_155_111, '0x12')).toThrow('proxy is missing or has unexpected bytecode')
	expect(() => assertExecutorDeploymentEnvironment(11_155_111, 11_155_111, deterministicDeploymentProxyCode)).not.toThrow()
})

test('distinguishes an empty address from matching and conflicting executor runtime', () => {
	const runtime = '0x1234'
	const expectedHash = keccak256(runtime)
	expect(executorCodeStatus(undefined, expectedHash)).toBe('missing')
	expect(executorCodeStatus('0x', expectedHash)).toBe('missing')
	expect(executorCodeStatus(runtime, expectedHash)).toBe('verified')
	expect(() => executorCodeStatus('0xabcd', expectedHash)).toThrow('unexpected runtime bytecode')
})

test('rejects a reverted CREATE2 receipt', () => {
	const hash = `0x${'11'.repeat(32)}` as Hex
	expect(() => assertExecutorDeploymentReceipt('reverted', hash)).toThrow(`reverted: ${hash}`)
	expect(() => assertExecutorDeploymentReceipt('success', hash)).not.toThrow()
})

test('broadcasts one signed executor deployment through every public RPC and tolerates one failure', async () => {
	const transactionHash = `0x${'22'.repeat(32)}` as Hex
	const serializedTransaction = '0x1234' as Hex
	const submissions: { transaction: Hex; url: string }[] = []
	const result = await submitExecutorDeploymentTransaction({
		account: `0x${'11'.repeat(20)}`,
		publicRpcUrls: ['https://primary.example', 'https://secondary.example'],
		publicSubmit: async (url, transaction) => {
			submissions.push({ transaction, url })
			if (url.includes('primary')) throw new Error('primary unavailable')
			return transactionHash
		},
		serializedTransaction,
		transactionHash,
	})

	expect(submissions).toEqual([
		{ transaction: serializedTransaction, url: 'https://primary.example' },
		{ transaction: serializedTransaction, url: 'https://secondary.example' },
	])
	expect(result.hash).toBe(transactionHash)
	expect(result.acceptedTargets).toEqual(['https://secondary.example'])
	expect(result.failedTargets).toHaveLength(1)
})

test('durably round trips and clears the exact signed executor deployment intent', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-intent-'))
	try {
		const privateKey = `0x${'11'.repeat(32)}` as Hex
		const account = privateKeyToAccount(privateKey)
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const intent = {
			account: account.address,
			address: plan.address,
			chainId: 1,
			salt,
			serializedTransaction,
			transactionHash: keccak256(serializedTransaction),
			version: 1,
		} satisfies ExecutorDeploymentIntent
		const path = join(directory, 'deployment.json')
		await saveExecutorDeploymentIntent(path, intent)
		await expect(loadExecutorDeploymentIntent(path)).resolves.toEqual(intent)
		await clearExecutorDeploymentIntent(path)
		await expect(loadExecutorDeploymentIntent(path)).resolves.toBeUndefined()
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('blocks resume while a durable executor deployment intent remains unresolved', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-resume-'))
	try {
		const privateKey = `0x${'11'.repeat(32)}` as Hex
		const account = privateKeyToAccount(privateKey)
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const settingsFile = join(directory, 'operator.json')
		const intentPath = executorDeploymentIntentPath(settingsFile, 'mainnet')
		await saveExecutorDeploymentIntent(intentPath, { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 })
		await expect(requireNoPendingExecutorDeployment(settingsFile, 'mainnet')).rejects.toThrow('Recover the pending executor deployment')
		await expect(requireNoPendingExecutorDeployment(settingsFile, 'sepolia')).resolves.toBeUndefined()
		await clearExecutorDeploymentIntent(intentPath)
		await expect(requireNoPendingExecutorDeployment(settingsFile, 'mainnet')).resolves.toBeUndefined()
		const dormantIntentPath = executorDeploymentIntentPath(settingsFile, 'sepolia')
		await saveExecutorDeploymentIntent(dormantIntentPath, { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 })
		const activeGate = createSignerOperationGate()
		const activeScanLock = await acquireScanSignerOperation(activeGate, { pending: false }, intentPath)
		expect(activeScanLock).toBeDefined()
		activeGate.release('scan')
		await activeScanLock?.release()
		await clearExecutorDeploymentIntent(dormantIntentPath)
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('blocks every scan signer path until deployment recovery clears its durable intent', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-scan-gate-'))
	const gate = createSignerOperationGate()
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex)
	const salt = `0x${'22'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
	const deploymentRecovery = deploymentRecoveryState({ pending: true, transactionHash: keccak256(serializedTransaction) })
	const intentPath = join(directory, 'deployment.json')
	try {
		expect(await acquireScanSignerOperation(gate, deploymentRecovery, intentPath)).toBeUndefined()
		clearDeploymentRecovery(deploymentRecovery)
		const intentLock = await acquireScanSignerOperation(gate, deploymentRecovery, intentPath)
		expect(intentLock).toBeDefined()
		await expect(acquireExecutorDeploymentIntentLock(intentPath)).rejects.toThrow('already locked')
		gate.release('scan')
		await intentLock?.release()
		await saveExecutorDeploymentIntent(intentPath, { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 })
		expect(await acquireScanSignerOperation(gate, deploymentRecovery, intentPath)).toBeUndefined()
		// The scan-time detection names the journaled transaction so the dashboard can link it, and clearing drops both fields together.
		expect(deploymentRecovery).toEqual({ pending: true, transactionHash: keccak256(serializedTransaction) })
		expect(executorDeploymentRecoveryStatus(deploymentRecovery)).toEqual({ transactionHash: keccak256(serializedTransaction) })
		clearDeploymentRecovery(deploymentRecovery)
		expect(deploymentRecovery).toEqual({ pending: false, transactionHash: undefined })
		expect(executorDeploymentRecoveryStatus(deploymentRecovery)).toBeUndefined()
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('resumes scanning after an external reconciliation only once the executor bytecode is verified', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-reconciled-'))
	try {
		const account = privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex)
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const transactionHash = keccak256(serializedTransaction)
		const intentPath = join(directory, 'deployment.json')
		const deploymentRecovery = deploymentRecoveryState({ pending: true, transactionHash })
		const reconciled: Hex[] = []
		let executorDeployed = false
		let verifications = 0
		const reconciliation = {
			onReconciled: (hash: Hex) => {
				reconciled.push(hash)
			},
			verifyExecutorDeployed: async () => {
				verifications += 1
				return executorDeployed
			},
		}
		// While the journal exists it is authoritative: no bytecode check, and the pending hash follows the journal.
		await saveExecutorDeploymentIntent(intentPath, { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash, version: 1 })
		expect(await acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, reconciliation)).toBeUndefined()
		expect(verifications).toBe(0)
		expect(deploymentRecovery).toEqual({ pending: true, transactionHash })
		// The CLI removed the journal, but the chain does not show the executor yet: the signed transaction may still be broadcast.
		await clearExecutorDeploymentIntent(intentPath)
		expect(await acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, reconciliation)).toBeUndefined()
		expect(verifications).toBe(1)
		expect(deploymentRecovery).toEqual({ pending: true, transactionHash })
		expect(reconciled).toEqual([])
		// Without a reconciliation check the scan stays deferred regardless of the chain.
		executorDeployed = true
		expect(await acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath)).toBeUndefined()
		expect(deploymentRecovery.pending).toBe(true)
		// Verified bytecode settles the recovery: the state clears, the operator log names the transaction, and the scan takes its turn.
		const gate = createSignerOperationGate()
		const intentLock = await acquireScanSignerOperation(gate, deploymentRecovery, intentPath, reconciliation)
		expect(intentLock).toBeDefined()
		expect(deploymentRecovery).toEqual({ pending: false, transactionHash: undefined })
		expect(reconciled).toEqual([transactionHash])
		expect(gate.acquire('configuration')).toBe(false)
		gate.release('scan')
		await intentLock?.release()
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('verifies the executor bytecode without holding the journal lock and defers only on genuine lock contention', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-locked-'))
	try {
		const intentPath = join(directory, 'deployment.json')
		const deploymentRecovery = deploymentRecoveryState({ pending: true, transactionHash: `0x${'33'.repeat(32)}` as Hex })
		// The CLI or dashboard must be able to take the journal lock while the scan's bytecode check is in flight.
		let finishVerification: ((deployed: boolean) => void) | undefined
		const verification = new Promise<boolean>(resolve => {
			finishVerification = resolve
		})
		const blocked = acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, { onReconciled: () => undefined, verifyExecutorDeployed: () => verification })
		await Bun.sleep(20)
		const concurrent = await acquireExecutorDeploymentIntentLock(intentPath)
		await concurrent.release()
		finishVerification?.(true)
		const intentLock = await blocked
		expect(intentLock).toBeDefined()
		expect(deploymentRecovery.pending).toBe(false)
		await intentLock?.release()

		// A deployment that holds the journal lock keeps a pending recovery deferred instead of failing the poll.
		Object.assign(deploymentRecovery, { pending: true, transactionHash: `0x${'33'.repeat(32)}` as Hex })
		const held = await acquireExecutorDeploymentIntentLock(intentPath)
		try {
			const reconciliation = { onReconciled: () => undefined, verifyExecutorDeployed: async () => true }
			expect(await acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, reconciliation)).toBeUndefined()
			expect(deploymentRecovery.pending).toBe(true)
			// Without a pending recovery the contention is still an error the poll reports.
			clearDeploymentRecovery(deploymentRecovery)
			await expect(acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, reconciliation)).rejects.toThrow('already locked')
		} finally {
			await held.release()
		}
		// Lock failures other than contention still surface while pending: a directory in place of the lock file cannot be opened.
		Object.assign(deploymentRecovery, { pending: true, transactionHash: `0x${'33'.repeat(32)}` as Hex })
		const probe = await acquireExecutorDeploymentIntentLock(intentPath)
		const lockPath = probe.path
		await probe.release()
		await rm(lockPath, { force: true })
		await mkdir(lockPath)
		try {
			let verifications = 0
			const verifyExecutorDeployed = async () => {
				verifications += 1
				return true
			}
			await expect(acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, { onReconciled: () => undefined, verifyExecutorDeployed })).rejects.toThrow()
			await expect(acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath, { onReconciled: () => undefined, verifyExecutorDeployed })).rejects.not.toThrow('already locked')
			expect(verifications).toBe(2)
			expect(deploymentRecovery.pending).toBe(true)
		} finally {
			await rm(lockPath, { force: true, recursive: true })
		}
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('activates the signer blocker as soon as a fresh deployment intent is durable', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-persist-block-'))
	try {
		const privateKey = `0x${'11'.repeat(32)}` as Hex
		const account = privateKeyToAccount(privateKey)
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const deploymentRecovery = deploymentRecoveryState()
		const intentPath = join(directory, 'deployment.json')
		await persistExecutorDeploymentIntentForRecovery(intentPath, { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 }, deploymentRecovery)
		expect(deploymentRecovery).toEqual({ pending: true, transactionHash: keccak256(serializedTransaction) })
		expect(await acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, intentPath)).toBeUndefined()
		expect(await loadExecutorDeploymentIntent(intentPath)).toBeDefined()
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('keeps the signer blocker active when deployment intent persistence is uncertain', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-persist-failure-'))
	try {
		const privateKey = `0x${'11'.repeat(32)}` as Hex
		const account = privateKeyToAccount(privateKey)
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const deploymentRecovery = deploymentRecoveryState()
		const parentFile = join(directory, 'not-a-directory')
		await writeFile(parentFile, 'occupied', 'utf8')
		await expect(persistExecutorDeploymentIntentForRecovery(join(parentFile, 'deployment.json'), { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 }, deploymentRecovery)).rejects.toThrow()
		expect(deploymentRecovery).toEqual({ pending: true, transactionHash: keccak256(serializedTransaction) })
		expect(await acquireScanSignerOperation(createSignerOperationGate(), deploymentRecovery, join(parentFile, 'deployment.json'))).toBeUndefined()
	} finally {
		await rm(directory, { force: true, recursive: true })
	}
})

test('rejects a mismatched pending intent before externally deployed runtime recovery', async () => {
	const privateKey = `0x${'11'.repeat(32)}` as Hex
	const account = privateKeyToAccount(privateKey)
	const salt = `0x${'22'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
	const intent = {
		account: account.address,
		address: plan.address,
		chainId: 1,
		salt,
		serializedTransaction,
		transactionHash: keccak256(serializedTransaction),
		version: 1,
	} satisfies ExecutorDeploymentIntent
	await expect(assertExecutorDeploymentIntent({ ...intent, salt: `0x${'33'.repeat(32)}` }, account.address, 1, plan)).rejects.toThrow('does not match')
	const altered = await account.signTransaction({ chainId: 1, data: '0x1234', gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
	await expect(assertExecutorDeploymentIntent({ ...intent, serializedTransaction: altered, transactionHash: keccak256(altered) }, account.address, 1, plan)).rejects.toThrow('expected CREATE2 call')
	const funded = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy, value: 1n })
	await expect(assertExecutorDeploymentIntent({ ...intent, serializedTransaction: funded, transactionHash: keccak256(funded) }, account.address, 1, plan)).rejects.toThrow('must not transfer ETH')
})

test('clearing an absent deployment intent is idempotent when its directory is absent', async () => {
	const directory = join(tmpdir(), `zoltar-missing-executor-intent-${crypto.randomUUID()}`)
	await expect(clearExecutorDeploymentIntent(join(directory, 'deployment.json'))).resolves.toBeUndefined()
})

test('syncs the parent directory when retrying an intent clear after unlink already succeeded', async () => {
	let synced = 0
	let closed = 0
	await clearExecutorDeploymentIntent('/operator/deployment.json', {
		open: () => Promise.resolve({ close: () => Promise.resolve(void (closed += 1)), sync: () => Promise.resolve(void (synced += 1)) }),
		readFile: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
		rm: () => Promise.reject(new Error('unlink should not repeat')),
	})
	expect(synced).toBe(1)
	expect(closed).toBe(1)
})

test('syncs the parent directory before startup treats an absent intent as durably cleared', async () => {
	let synced = 0
	let closed = 0
	await expect(
		loadExecutorDeploymentIntent('/operator/deployment.json', {
			open: () => Promise.resolve({ close: () => Promise.resolve(void (closed += 1)), sync: () => Promise.resolve(void (synced += 1)) }),
			readFile: () => Promise.reject(Object.assign(new Error('missing after unlink'), { code: 'ENOENT' })),
		}),
	).resolves.toBeUndefined()
	expect(synced).toBe(1)
	expect(closed).toBe(1)
})

test('standalone deployment shares the operator signer lock and durable recovery path', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-executor-cli-recovery-'))
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex)
	const settingsFile = join(directory, 'operator.json')
	const intentPath = executorDeploymentIntentPath(settingsFile, 'mainnet')
	const intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
	const lock = await acquireExecutionSignerLock(1, account.address)
	try {
		await expect(acquireExecutorDeploymentIntentLock(intentPath)).rejects.toThrow('already locked')
		await expect(acquireExecutionSignerLock(1, account.address)).rejects.toThrow('already locked')
		const salt = `0x${'22'.repeat(32)}` as Hex
		const plan = executorDeploymentPlan(salt)
		const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		await saveExecutorDeploymentIntent(intentPath, { account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 })
	} finally {
		try {
			await lock.release()
		} finally {
			await intentLock.release()
		}
	}
	try {
		await expect(requireNoPendingExecutorDeployment(settingsFile, 'mainnet')).rejects.toThrow('Recover the pending executor deployment')
	} finally {
		await clearExecutorDeploymentIntent(intentPath)
		await rm(directory, { force: true, recursive: true })
	}
})

test('syncs every newly created intent directory entry before opening the journal', async () => {
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex)
	const salt = `0x${'22'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	const serializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
	const events: string[] = []
	let directoriesCreated = false
	await saveExecutorDeploymentIntent(
		'/durable/a/operator/deployment.json',
		{ account: account.address, address: plan.address, chainId: 1, salt, serializedTransaction, transactionHash: keccak256(serializedTransaction), version: 1 },
		{
			mkdir: () => {
				directoriesCreated = true
				events.push('mkdir')
				return Promise.resolve()
			},
			openDirectory: path => {
				if (!directoriesCreated && (path === '/durable/a/operator' || path === '/durable/a')) return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
				return Promise.resolve({
					close: () => Promise.resolve(),
					sync: () => {
						events.push(`sync:${path}`)
						return Promise.resolve()
					},
				})
			},
			openFile: () => {
				events.push('open-file')
				return Promise.resolve({ chmod: () => Promise.resolve(), close: () => Promise.resolve(), sync: () => Promise.resolve(), writeFile: () => Promise.resolve() })
			},
			rename: () => Promise.resolve(),
			rm: () => Promise.resolve(),
		},
	)
	expect(events.slice(0, 4)).toEqual(['mkdir', 'sync:/durable/a', 'sync:/durable', 'open-file'])
	expect(events.at(-1)).toBe('sync:/durable/a/operator')
})

test('requires three distinct read RPC origins inside the deployment primitive under the explicit quorum policy', async () => {
	const common = {
		chain: mainnet,
		persistIntent: async () => undefined,
		privateKey: `0x${'11'.repeat(32)}` as Hex,
		rpcUrls: ['https://submit.example'],
		salt: `0x${'22'.repeat(32)}`,
	}
	const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
	try {
		process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
		await expect(deployExecutorCreate2({ ...common, readRpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'] })).rejects.toThrow('three independent read RPC origins')
		await expect(deployExecutorCreate2({ ...common, readRpcUrls: ['https://rpc-a.example/one', 'https://rpc-a.example/two', 'https://rpc-b.example'] })).rejects.toThrow('three independent read RPC origins')
	} finally {
		if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
		else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
	}
})

test('passes every effective public RPC from the dashboard deployment path', async () => {
	const primaryRpcUrl = 'https://primary.example/'
	const publicRpcUrls = [primaryRpcUrl, 'https://secondary.example/']
	let receivedRpcUrls: readonly string[] = []
	await deployExecutorFromConnectivity(
		{
			chain: mainnet,
			connectivity: { publicRpcUrls, readRpcUrl: primaryRpcUrl },
			privateKey: `0x${'11'.repeat(32)}`,
			quorumRpcUrls: ['https://quorum-a.example/', 'https://quorum-b.example/'],
			rpcQuorum: 2,
			salt: `0x${'22'.repeat(32)}`,
		},
		async parameters => {
			receivedRpcUrls = parameters.rpcUrls
			return { address: `0x${'33'.repeat(20)}`, alreadyDeployed: false, transactionHash: `0x${'44'.repeat(32)}` }
		},
	)

	expect(receivedRpcUrls).toEqual(publicRpcUrls)
})

async function runDeploymentScenario(options: {
	alreadyDeployed?: boolean
	existingIntent?: boolean
	gasPrices?: Partial<Record<'primary' | 'secondary' | 'tertiary', bigint>>
	lifecycleEvents?: string[]
	matchingExistingReceipt?: boolean
	primaryPreparationFails: boolean
	primaryReceiptFails: boolean
	receiptsUnavailable?: boolean
	storedReceiptMissing?: boolean
	tertiaryCodeLagsPolls?: number
	tertiaryReceiptLagsPolls?: number
}) {
	const privateKey = `0x${'11'.repeat(32)}` as Hex
	const account = privateKeyToAccount(privateKey)
	const salt = `0x${'22'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	const runtimeCode = `0x${executorArtifact.evm.deployedBytecode.object}` as Hex
	const broadcastRequests: { transaction: Hex; url: string }[] = []
	const lifecycleEvents = options.lifecycleEvents ?? []
	let deployed = options.alreadyDeployed === true
	let transactionHash = `0x${'00'.repeat(32)}` as Hex
	let tertiaryReceiptPolls = 0
	// A lagging tertiary has not imported the inclusion block, so it exposes neither the receipt nor the deployed code until its lag is exhausted.
	const tertiaryLagging = (name: string) => name === 'tertiary' && tertiaryReceiptPolls < (options.tertiaryReceiptLagsPolls ?? 0)
	// A tertiary with lagging code serves the receipt while its code backend still answers from before the inclusion block.
	const tertiaryCodeLagging = (name: string) => name === 'tertiary' && options.tertiaryCodeLagsPolls !== undefined && tertiaryReceiptPolls <= options.tertiaryCodeLagsPolls

	const rpcResponse = (result: unknown) => Response.json({ id: 1, jsonrpc: '2.0', result })
	const handler = (name: 'primary' | 'secondary' | 'tertiary') => async (request: Request) => {
		const body: unknown = await request.json()
		if (typeof body !== 'object' || body === null || Array.isArray(body) || !('method' in body) || typeof body.method !== 'string' || !('params' in body) || !Array.isArray(body.params)) {
			return new Response('invalid request', { status: 400 })
		}
		if (body.method === 'eth_chainId') return rpcResponse('0x1')
		// The mock chain never advances past the inclusion block, so deployment must complete on the receipt alone.
		if (body.method === 'eth_blockNumber') return rpcResponse('0x64')
		if (body.method === 'eth_getTransactionCount') return rpcResponse('0x0')
		if (body.method === 'eth_estimateGas') return rpcResponse('0x300000')
		if (body.method === 'eth_gasPrice') return name === 'primary' && options.primaryPreparationFails ? new Response('primary preparation unavailable', { status: 503 }) : rpcResponse(`0x${(options.gasPrices?.[name] ?? 1_000_000_000n).toString(16)}`)
		if (body.method === 'eth_getCode') {
			const address = body.params[0]
			if (typeof address !== 'string') return new Response('invalid address', { status: 400 })
			if (address.toLowerCase() === deterministicDeploymentProxy.toLowerCase()) return rpcResponse(deterministicDeploymentProxyCode)
			if (address.toLowerCase() === plan.address.toLowerCase()) return rpcResponse(deployed && !tertiaryLagging(name) && !tertiaryCodeLagging(name) ? runtimeCode : '0x')
			return rpcResponse('0x')
		}
		if (body.method === 'eth_sendRawTransaction') {
			lifecycleEvents.push(`broadcast:${name}`)
			const transaction = body.params[0]
			if (typeof transaction !== 'string' || !transaction.startsWith('0x')) return new Response('invalid transaction', { status: 400 })
			const normalizedTransaction: Hex = `0x${transaction.slice(2)}`
			broadcastRequests.push({ transaction: normalizedTransaction, url: name })
			if (name === 'primary') return new Response('primary broadcast unavailable', { status: 503 })
			transactionHash = keccak256(normalizedTransaction)
			deployed = true
			return rpcResponse(transactionHash)
		}
		if (body.method === 'eth_getTransactionReceipt') {
			if (options.receiptsUnavailable || (name === 'primary' && options.primaryReceiptFails)) return new Response(`${name} receipt unavailable`, { status: 503 })
			if (options.storedReceiptMissing) return rpcResponse(null)
			const lagging = tertiaryLagging(name)
			if (name === 'tertiary') tertiaryReceiptPolls += 1
			if (lagging) return rpcResponse(null)
			return rpcResponse({
				blockHash: `0x${'aa'.repeat(32)}`,
				blockNumber: '0x64',
				contractAddress: null,
				cumulativeGasUsed: '0x5208',
				effectiveGasPrice: '0x1',
				from: account.address,
				gasUsed: '0x5208',
				logs: [],
				logsBloom: `0x${'00'.repeat(256)}`,
				status: '0x1',
				to: deterministicDeploymentProxy,
				transactionHash,
				transactionIndex: '0x0',
				type: '0x2',
			})
		}
		return new Response(`unexpected method ${body.method}`, { status: 500 })
	}

	const primary = Bun.serve({ fetch: handler('primary'), port: 0 })
	const secondary = Bun.serve({ fetch: handler('secondary'), port: 0 })
	const tertiary = Bun.serve({ fetch: handler('tertiary'), port: 0 })
	try {
		const primaryPort = primary.port
		const secondaryPort = secondary.port
		const tertiaryPort = tertiary.port
		if (primaryPort === undefined || secondaryPort === undefined || tertiaryPort === undefined) throw new Error('Mock RPC server did not expose a port')
		const primaryUrl = `http://127.0.0.1:${primaryPort.toString()}`
		const secondaryUrl = `http://127.0.0.1:${secondaryPort.toString()}`
		const tertiaryUrl = `http://127.0.0.1:${tertiaryPort.toString()}`
		let persistedIntent
		const recoveredSerializedTransaction = await account.signTransaction({ chainId: 1, data: plan.calldata, gas: 3_000_000n, gasPrice: 1n, nonce: 0, to: deterministicDeploymentProxy })
		const existingIntent = options.existingIntent
			? ({
					account: account.address,
					address: plan.address,
					chainId: 1,
					salt,
					serializedTransaction: recoveredSerializedTransaction,
					transactionHash: keccak256(recoveredSerializedTransaction),
					version: 1,
				} satisfies ExecutorDeploymentIntent)
			: undefined
		if (options.matchingExistingReceipt && existingIntent !== undefined) transactionHash = existingIntent.transactionHash
		const result = await deployExecutorCreate2({
			chain: mainnet,
			existingIntent,
			persistIntent: async intent => {
				persistedIntent = intent
				lifecycleEvents.push('persist')
			},
			privateKey,
			readRpcUrls: [primaryUrl, secondaryUrl, tertiaryUrl],
			rpcUrls: [primaryUrl, secondaryUrl],
			salt,
		})
		if (existingIntent === undefined) expect(persistedIntent).toBeDefined()
		return { broadcastRequests, expected: { address: plan.address, alreadyDeployed: false, transactionHash }, lifecycleEvents, result, tertiaryReceiptPolls }
	} finally {
		primary.stop(true)
		secondary.stop(true)
		tertiary.stop(true)
	}
}

test('persists before broadcasting and tolerates one unavailable preparation reader', async () => {
	const { broadcastRequests, expected, lifecycleEvents, result } = await runDeploymentScenario({ primaryPreparationFails: true, primaryReceiptFails: false })
	expect(result).toEqual(expected)
	expect(lifecycleEvents[0]).toBe('persist')
	expect(broadcastRequests.map(request => request.url).sort()).toEqual(['primary', 'secondary'])
	expect(broadcastRequests[0]?.transaction).toBe(broadcastRequests[1]?.transaction)
})

test('rejects a divergent extreme deployment gas price before persistence or submission', async () => {
	const lifecycleEvents: string[] = []
	await expect(
		runDeploymentScenario({
			gasPrices: { tertiary: 10n ** 30n },
			lifecycleEvents,
			primaryPreparationFails: false,
			primaryReceiptFails: false,
		}),
	).rejects.toThrow('RPC disagreement for executor deployment gas price')
	expect(lifecycleEvents).toEqual([])
})

test('confirms through the secondary when the primary fails receipt polling after broadcast', async () => {
	const { broadcastRequests, expected, result } = await runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: true })
	expect(result).toEqual(expected)
	expect(broadcastRequests).toHaveLength(2)
	expect(broadcastRequests[0]?.transaction).toBe(broadcastRequests[1]?.transaction)
})

test('completes deployment once the receipt is included without waiting for confirmations', async () => {
	const startedAt = Date.now()
	const { expected, result } = await runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: false })
	expect(result).toEqual(expected)
	expect(Date.now() - startedAt).toBeLessThan(5_000)
})

async function withRpcQuorum<T>(requirement: '1' | '2', run: () => Promise<T>) {
	const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
	try {
		process.env['ZOLTAR_BOT_RPC_QUORUM'] = requirement
		return await run()
	} finally {
		if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
		else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
	}
}

test('keeps polling under quorum 2 while a lagging reader is needed to see the included receipt', async () => {
	const { expected, result, tertiaryReceiptPolls } = await withRpcQuorum('2', () => runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: true, tertiaryReceiptLagsPolls: 2 }))
	expect(result).toEqual(expected)
	expect(tertiaryReceiptPolls).toBeGreaterThanOrEqual(3)
})

test('ignores a lagging reader that has neither the receipt nor the code once the quorum has both', async () => {
	const { expected, result, tertiaryReceiptPolls } = await withRpcQuorum('2', () => runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: false, tertiaryReceiptLagsPolls: 2 }))
	expect(result).toEqual(expected)
	expect(tertiaryReceiptPolls).toBe(1)
})

test('keeps polling when a reader serves the success receipt before its code backend imported the block', async () => {
	const defaultQuorum = await runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: false, tertiaryCodeLagsPolls: 2 })
	expect(defaultQuorum.result).toEqual(defaultQuorum.expected)
	const onlySecondaryConsistent = await runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: true, tertiaryCodeLagsPolls: 2 })
	expect(onlySecondaryConsistent.result).toEqual(onlySecondaryConsistent.expected)
	expect(onlySecondaryConsistent.tertiaryReceiptPolls).toBe(1)
	const quorum = await withRpcQuorum('2', () => runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: true, tertiaryCodeLagsPolls: 2 }))
	expect(quorum.result).toEqual(quorum.expected)
	expect(quorum.tertiaryReceiptPolls).toBeGreaterThanOrEqual(3)
})

test('reports every reader failure when no reader can serve the deployment receipt', async () => {
	await expect(runDeploymentScenario({ primaryPreparationFails: false, primaryReceiptFails: false, receiptsUnavailable: true })).rejects.toThrow(/executor deployment receipt requires at least one available RPC endpoint; .*returned HTTP 503 while calling eth_getTransactionReceipt/)
})

test('recovers only when the stored executor deployment transaction itself is included', async () => {
	const { broadcastRequests, result } = await runDeploymentScenario({ alreadyDeployed: true, existingIntent: true, matchingExistingReceipt: true, primaryPreparationFails: false, primaryReceiptFails: false })
	expect(result.alreadyDeployed).toBe(true)
	expect(result.transactionHash).toBeDefined()
	expect(broadcastRequests).toEqual([])
})

test('keeps recovery pending when matching executor code came from another transaction', async () => {
	await expect(runDeploymentScenario({ alreadyDeployed: true, existingIntent: true, primaryPreparationFails: false, primaryReceiptFails: false, storedReceiptMissing: true })).rejects.toThrow('no quorum-visible receipt')
})
