import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex } from '#ethereum'

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

export async function saveExecutorDeploymentIntent(path: string, intent: ExecutorDeploymentIntent) {
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const handle = await open(temporaryPath, 'wx', 0o600)
		try {
			await handle.writeFile(`${JSON.stringify(intent, undefined, 2)}\n`, 'utf8')
			await handle.chmod(0o600)
			await handle.sync()
		} finally {
			await handle.close()
		}
		await rename(temporaryPath, path)
		const directory = await open(dirname(path), 'r')
		try {
			await directory.sync()
		} finally {
			await directory.close()
		}
	} catch (error) {
		await rm(temporaryPath, { force: true })
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
