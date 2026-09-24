import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import type { PendingTransactionIntent } from './operator-state.ts'

type ReceiptExpectation = PendingTransactionIntent['receiptExpectation']

function parseStagedOperation(value: unknown): 0 | 1 {
	if (value === 0 || value === 1) return value
	throw new Error('Pending transaction intent has invalid staged operation')
}

function parseReceiptExpectation(rawExpectation: object): ReceiptExpectation {
	const expectationType = Reflect.get(rawExpectation, 'type')
	if (expectationType === 'transaction') return { type: 'transaction' }
	if (expectationType === 'coordinator-operation' || expectationType === 'staged-success') {
		return { coordinator: getAddress(String(Reflect.get(rawExpectation, 'coordinator'))), operation: parseStagedOperation(Reflect.get(rawExpectation, 'operation')), type: expectationType }
	}
	if (expectationType === 'pending-liquidation') {
		return {
			amount: BigInt(String(Reflect.get(rawExpectation, 'amount'))),
			coordinator: getAddress(String(Reflect.get(rawExpectation, 'coordinator'))),
			operator: getAddress(String(Reflect.get(rawExpectation, 'operator'))),
			receiver: getAddress(String(Reflect.get(rawExpectation, 'receiver'))),
			target: getAddress(String(Reflect.get(rawExpectation, 'target'))),
			type: 'pending-liquidation',
		}
	}
	throw new Error('Pending transaction intent has invalid receipt expectation')
}

export async function parsePendingTransactionIntent(intent: unknown, expectedChainId: number): Promise<PendingTransactionIntent> {
	if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) throw new Error('Pending transaction intent must be an object')
	const hash = Reflect.get(intent, 'hash')
	const kind = Reflect.get(intent, 'kind')
	const label = Reflect.get(intent, 'label')
	const maxBlockNumber = Reflect.get(intent, 'maxBlockNumber')
	const lastValidBlockNumber = Reflect.get(intent, 'lastValidBlockNumber')
	const reconciliationReason = Reflect.get(intent, 'reconciliationReason')
	if (lastValidBlockNumber !== undefined && (typeof lastValidBlockNumber !== 'string' || !/^[0-9]+$/.test(lastValidBlockNumber))) throw new Error('Pending transaction intent has invalid calldata deadline')
	if (reconciliationReason !== undefined && typeof reconciliationReason !== 'string') throw new Error('Pending transaction intent has invalid reconciliation reason')
	const mode = Reflect.get(intent, 'mode')
	const nonce = Reflect.get(intent, 'nonce')
	const rawExpectation = Reflect.get(intent, 'receiptExpectation')
	const rawRequiresMarketEvidence = Reflect.get(intent, 'requiresMarketEvidence')
	const sender = Reflect.get(intent, 'sender')
	const serializedTransaction = Reflect.get(intent, 'serializedTransaction')
	const submissionBlock = Reflect.get(intent, 'submissionBlock')
	if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash) || typeof serializedTransaction !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(serializedTransaction)) throw new Error('Pending transaction intent has invalid transaction hex')
	if (keccak256(serializedTransaction as Hex).toLowerCase() !== hash.toLowerCase()) throw new Error('Pending transaction intent hash does not match its serialized transaction')
	if (typeof label !== 'string' || (kind !== 'deployment' && kind !== 'deposit' && kind !== 'fees' && kind !== 'liquidation' && kind !== 'migration' && kind !== 'withdrawal')) throw new Error('Pending transaction intent has invalid metadata')
	if (mode !== 'private' && mode !== 'public') throw new Error('Pending transaction intent has invalid mode')
	if (typeof nonce !== 'string' || typeof maxBlockNumber !== 'string' || typeof submissionBlock !== 'string') throw new Error('Pending transaction intent has invalid numeric metadata')
	if (typeof sender !== 'string') throw new Error('Pending transaction intent is missing sender')
	const parsedNonce = BigInt(nonce)
	const parsedTransaction = parseTransaction(serializedTransaction as Hex)
	if (parsedTransaction.chainId !== BigInt(expectedChainId)) throw new Error(`Pending transaction intent belongs to chain ${parsedTransaction.chainId?.toString() ?? 'unknown'}, expected chain ${expectedChainId.toString()}`)
	if (parsedTransaction.nonce !== parsedNonce) throw new Error('Pending transaction intent nonce does not match its serialized transaction')
	const normalizedSender = getAddress(sender)
	const recoveredSender = await recoverTransactionAddress({ serializedTransaction: serializedTransaction as Hex })
	if (recoveredSender.toLowerCase() !== normalizedSender.toLowerCase()) throw new Error('Pending transaction intent sender does not match its serialized transaction')
	if (typeof rawExpectation !== 'object' || rawExpectation === null || Array.isArray(rawExpectation)) throw new Error('Pending transaction intent is missing receipt expectation')
	const receiptExpectation = parseReceiptExpectation(rawExpectation)
	const requiresMarketEvidence = typeof rawRequiresMarketEvidence === 'boolean' ? rawRequiresMarketEvidence : kind === 'deposit' || kind === 'liquidation' || kind === 'withdrawal'
	return {
		lastValidBlockNumber: lastValidBlockNumber === undefined ? undefined : BigInt(lastValidBlockNumber),
		reconciliationReason,
		hash: hash as Hex,
		kind,
		label,
		maxBlockNumber: BigInt(maxBlockNumber),
		mode,
		nonce: parsedNonce,
		receiptExpectation,
		requiresMarketEvidence,
		sender: normalizedSender,
		serializedTransaction: serializedTransaction as Hex,
		submissionBlock: BigInt(submissionBlock),
	}
}
