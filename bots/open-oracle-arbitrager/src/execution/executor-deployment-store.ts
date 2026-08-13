import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex } from '#ethereum'
import { acquireExclusiveProcessLock } from '@zoltar/bot-shared/execution/process-lock'

export type ExecutorDeploymentIntent = {
	account: Address
	address: Address
	chainId: number
	salt: Hex
	serializedTransaction: Hex
	transactionHash: Hex
	version: 1
}

export function executorDeploymentIntentPath(settingsFile: string) {
	return `${settingsFile}.executor-deployment.json`
}

export function acquireExecutorDeploymentIntentLock(path: string) {
	const intentPath = resolve(path)
	const lockName = createHash('sha256').update(intentPath).digest('hex')
	return acquireExclusiveProcessLock(join(tmpdir(), 'zoltar-bot-locks', `executor-intent-${lockName}.lock`), `Executor deployment intent ${intentPath}`, { intentPath })
}

function parseHex(value: unknown, bytes: number, label: string) {
	if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${(bytes * 2).toString()}}$`).test(value)) throw new Error(`Executor deployment intent ${label} is invalid`)
	return value as Hex
}

export async function parseExecutorDeploymentIntent(value: unknown): Promise<ExecutorDeploymentIntent> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Executor deployment intent must be an object')
	const record = value as Record<string, unknown>
	const keys = ['account', 'address', 'chainId', 'salt', 'serializedTransaction', 'transactionHash', 'version']
	if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !(key in record)) || record['version'] !== 1) throw new Error('Executor deployment intent has an unsupported shape')
	if (!Number.isSafeInteger(record['chainId']) || Number(record['chainId']) <= 0) throw new Error('Executor deployment intent chainId is invalid')
	if (typeof record['serializedTransaction'] !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(record['serializedTransaction'])) throw new Error('Executor deployment intent serializedTransaction is invalid')
	const serializedTransaction = record['serializedTransaction'] as Hex
	const transactionHash = parseHex(record['transactionHash'], 32, 'transactionHash')
	if (keccak256(serializedTransaction).toLowerCase() !== transactionHash.toLowerCase()) throw new Error('Executor deployment intent transaction hash does not match its signed bytes')
	const chainId = Number(record['chainId'])
	if (parseTransaction(serializedTransaction).chainId !== BigInt(chainId)) throw new Error('Executor deployment intent signed transaction uses a different chain')
	const account = getAddress(String(record['account']))
	if ((await recoverTransactionAddress({ serializedTransaction })).toLowerCase() !== account.toLowerCase()) throw new Error('Executor deployment intent signed transaction uses a different account')
	return {
		account,
		address: getAddress(String(record['address'])),
		chainId,
		salt: parseHex(record['salt'], 32, 'salt'),
		serializedTransaction,
		transactionHash,
		version: 1,
	}
}

type DeploymentIntentReadFilesystem = {
	open(path: string, flags: 'r'): Promise<{ close(): Promise<void>; sync(): Promise<void> }>
	readFile(path: string, encoding: 'utf8'): Promise<string>
}

async function syncExistingParentDirectory(path: string, filesystem: DeploymentIntentReadFilesystem) {
	let directory
	try {
		directory = await filesystem.open(dirname(path), 'r')
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
		throw error
	}
	try {
		await directory.sync()
	} finally {
		await directory.close()
	}
}

export async function loadExecutorDeploymentIntent(path: string, filesystem: DeploymentIntentReadFilesystem = { open, readFile }) {
	let contents: string
	try {
		contents = await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
			await syncExistingParentDirectory(path, filesystem)
			return undefined
		}
		throw error
	}
	return parseExecutorDeploymentIntent(JSON.parse(contents))
}

type DeploymentIntentWriteFilesystem = {
	mkdir(path: string, options: { mode: number; recursive: true }): Promise<unknown>
	openDirectory(path: string): Promise<{ close(): Promise<void>; sync(): Promise<void> }>
	openFile(path: string): Promise<{ chmod(mode: number): Promise<void>; close(): Promise<void>; sync(): Promise<void>; writeFile(data: string, encoding: 'utf8'): Promise<void> }>
	rename(from: string, to: string): Promise<void>
	rm(path: string, options: { force: true }): Promise<void>
}

const deploymentIntentWriteFilesystem: DeploymentIntentWriteFilesystem = {
	mkdir,
	openDirectory: path => open(path, 'r'),
	openFile: path => open(path, 'wx', 0o600),
	rename,
	rm,
}

async function ensureDurableDirectory(path: string, filesystem: DeploymentIntentWriteFilesystem) {
	const missingDirectories: string[] = []
	let existingDirectory = path
	for (;;) {
		let handle
		try {
			handle = await filesystem.openDirectory(existingDirectory)
		} catch (error) {
			if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
			const parent = dirname(existingDirectory)
			if (parent === existingDirectory) throw error
			missingDirectories.push(existingDirectory)
			existingDirectory = parent
			continue
		}
		await handle.close()
		break
	}
	if (missingDirectories.length === 0) return
	await filesystem.mkdir(path, { mode: 0o700, recursive: true })
	for (const directory of missingDirectories) {
		const parent = await filesystem.openDirectory(dirname(directory))
		try {
			await parent.sync()
		} finally {
			await parent.close()
		}
	}
}

export async function saveExecutorDeploymentIntent(path: string, intent: ExecutorDeploymentIntent, filesystem: DeploymentIntentWriteFilesystem = deploymentIntentWriteFilesystem) {
	await ensureDurableDirectory(dirname(path), filesystem)
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const handle = await filesystem.openFile(temporaryPath)
		try {
			await handle.writeFile(`${JSON.stringify(intent, undefined, 2)}\n`, 'utf8')
			await handle.chmod(0o600)
			await handle.sync()
		} finally {
			await handle.close()
		}
		await filesystem.rename(temporaryPath, path)
		const directory = await filesystem.openDirectory(dirname(path))
		try {
			await directory.sync()
		} finally {
			await directory.close()
		}
	} catch (error) {
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
}

type DeploymentIntentFilesystem = DeploymentIntentReadFilesystem & {
	rm(path: string, options: { force: true }): Promise<void>
}

export async function clearExecutorDeploymentIntent(path: string, filesystem: DeploymentIntentFilesystem = { open, readFile, rm }) {
	try {
		await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
			await syncExistingParentDirectory(path, filesystem)
			return
		}
		throw error
	}
	await filesystem.rm(path, { force: true })
	await syncExistingParentDirectory(path, filesystem)
}
