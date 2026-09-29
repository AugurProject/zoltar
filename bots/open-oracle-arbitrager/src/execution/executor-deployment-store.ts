import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { durableFilesystem, syncDirectory, writeFileAtomically, type DurableWriteFilesystem } from '@zoltar/bot-shared/config/durable-file'
import { acquireExclusiveProcessLock } from '@zoltar/bot-shared/execution/process-lock'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'
import { isHash32 } from '@zoltar/bot-shared/infrastructure/json-validation'

export type ExecutorDeploymentIntent = {
	account: Address
	address: Address
	chainId: number
	salt: Hex
	serializedTransaction: Hex
	transactionHash: Hex
	version: 1
}

export function executorDeploymentIntentPath(settingsFile: string, network: 'mainnet' | 'sepolia') {
	return `${settingsFile}.${network}.executor-deployment.json`
}

export function acquireExecutorDeploymentIntentLock(path: string) {
	const intentPath = resolve(path)
	const lockName = createHash('sha256').update(intentPath).digest('hex')
	return acquireExclusiveProcessLock(join(tmpdir(), 'zoltar-bot-locks', `executor-intent-${lockName}.lock`), `Executor deployment intent ${intentPath}`, { intentPath })
}

function parseHash32(value: unknown, label: string) {
	if (!isHash32(value)) throw new Error(`Executor deployment intent ${label} is invalid`)
	return value
}

async function parseExecutorDeploymentIntent(value: unknown): Promise<ExecutorDeploymentIntent> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Executor deployment intent must be an object')
	const record = value as Record<string, unknown>
	const keys = ['account', 'address', 'chainId', 'salt', 'serializedTransaction', 'transactionHash', 'version']
	if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !(key in record)) || record['version'] !== 1) throw new Error('Executor deployment intent has an unsupported shape')
	if (!Number.isSafeInteger(record['chainId']) || Number(record['chainId']) <= 0) throw new Error('Executor deployment intent chainId is invalid')
	if (typeof record['serializedTransaction'] !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(record['serializedTransaction'])) throw new Error('Executor deployment intent serializedTransaction is invalid')
	const serializedTransaction = record['serializedTransaction'] as Hex
	const transactionHash = parseHash32(record['transactionHash'], 'transactionHash')
	if (keccak256(serializedTransaction).toLowerCase() !== transactionHash.toLowerCase()) throw new Error('Executor deployment intent transaction hash does not match its signed bytes')
	const chainId = Number(record['chainId'])
	if (parseTransaction(serializedTransaction).chainId !== BigInt(chainId)) throw new Error('Executor deployment intent signed transaction uses a different chain')
	const account = getAddress(String(record['account']))
	if ((await recoverTransactionAddress({ serializedTransaction })).toLowerCase() !== account.toLowerCase()) throw new Error('Executor deployment intent signed transaction uses a different account')
	return {
		account,
		address: getAddress(String(record['address'])),
		chainId,
		salt: parseHash32(record['salt'], 'salt'),
		serializedTransaction,
		transactionHash,
		version: 1,
	}
}

type DeploymentIntentReadFilesystem = {
	open(path: string, flags: 'r'): Promise<{ close(): Promise<unknown>; sync(): Promise<unknown> }>
	readFile(path: string, encoding: 'utf8'): Promise<string>
}

async function syncExistingParentDirectory(path: string, filesystem: DeploymentIntentReadFilesystem) {
	try {
		await syncDirectory(dirname(path), filesystem)
	} catch (error) {
		if (!isErrorCode(error, 'ENOENT')) throw error
	}
}

export async function loadExecutorDeploymentIntent(path: string, filesystem: DeploymentIntentReadFilesystem = durableFilesystem) {
	let contents: string
	try {
		contents = await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) {
			await syncExistingParentDirectory(path, filesystem)
			return undefined
		}
		throw error
	}
	return parseExecutorDeploymentIntent(JSON.parse(contents))
}

export async function loadExecutorDeploymentIntentForChain(path: string, expectedChainId: number, filesystem: DeploymentIntentReadFilesystem = durableFilesystem) {
	const intent = await loadExecutorDeploymentIntent(path, filesystem)
	if (intent !== undefined && intent.chainId !== expectedChainId) throw new Error(`Executor deployment intent targets chain ${intent.chainId.toString()}; expected chain ${expectedChainId.toString()}`)
	return intent
}

export async function saveExecutorDeploymentIntent(path: string, intent: ExecutorDeploymentIntent, filesystem?: DurableWriteFilesystem) {
	await writeFileAtomically(path, `${JSON.stringify(intent, undefined, 2)}\n`, { filesystem, syncCreatedDirectories: true })
}

type DeploymentIntentFilesystem = DeploymentIntentReadFilesystem & {
	rm(path: string, options: { force: true }): Promise<void>
}

export async function clearExecutorDeploymentIntent(path: string, filesystem: DeploymentIntentFilesystem = durableFilesystem) {
	try {
		await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) {
			await syncExistingParentDirectory(path, filesystem)
			return
		}
		throw error
	}
	await filesystem.rm(path, { force: true })
	await syncExistingParentDirectory(path, filesystem)
}
