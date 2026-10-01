import { getAddress, keccak256, parseTransaction, recoverTransactionAddress } from '@zoltar/bot-shared/ethereum'
import { parseEvidenceArray, parseStorageArguments, serializedTransaction, storageBaselineKey, stringArray } from './durable-record-parsers.ts'
import type { PendingTransactionIntent } from './operator-state.ts'
import { parsePendingTransactionObservation } from './pending-transaction-observation.ts'
import { assertExactKeys, dataHex, hash, identifier, nonemptyString, optionalString, optionalTimestamp, requiredRecord, timestamp, unsignedIntegerString } from './validators.ts'

/** Validates a durable pending transaction intent against its own signed serialized transaction and semantic expectation. */
export async function parsePendingTransaction(value: unknown, index: number, expectedChainId: number): Promise<PendingTransactionIntent> {
	const label = `pendingTransactions[${index.toString()}]`
	const intent = requiredRecord(value, label)
	assertExactKeys(
		intent,
		['data', 'hash', 'id', 'label', 'maxBlockNumber', 'mode', 'nonce', 'operationId', 'semanticExpectation', 'sender', 'serializedTransaction', 'signedAt', 'status', 'stepId', 'to', 'value', 'workflowId'],
		['cancellationHash', 'observation', 'recoveryBlocker', 'replacementHash', 'submissionBlock', 'submittedAt'],
		label,
	)
	const rawTransaction = serializedTransaction(intent['serializedTransaction'], `${label}.serializedTransaction`)
	const transactionHash = hash(intent['hash'], `${label}.hash`)
	if (keccak256(rawTransaction).toLowerCase() !== transactionHash.toLowerCase()) throw new Error(`${label}.hash does not match its serialized transaction`)
	const parsedTransaction = parseTransaction(rawTransaction)
	if (parsedTransaction.chainId !== BigInt(expectedChainId)) throw new Error(`${label} belongs to chain ${parsedTransaction.chainId?.toString() ?? 'unknown'}, expected chain ${expectedChainId.toString()}`)
	const nonce = BigInt(unsignedIntegerString(intent['nonce'], `${label}.nonce`))
	if (parsedTransaction.nonce !== nonce) throw new Error(`${label}.nonce does not match its serialized transaction`)
	const sender = getAddress(nonemptyString(intent['sender'], `${label}.sender`))
	const recoveredSender = await recoverTransactionAddress({ serializedTransaction: rawTransaction })
	if (recoveredSender.toLowerCase() !== sender.toLowerCase()) throw new Error(`${label}.sender does not match its serialized transaction`)
	const to = getAddress(nonemptyString(intent['to'], `${label}.to`))
	if (parsedTransaction.to === null || parsedTransaction.to === undefined || parsedTransaction.to.toLowerCase() !== to.toLowerCase()) throw new Error(`${label}.to does not match its serialized transaction`)
	const data = dataHex(intent['data'], `${label}.data`)
	if ((parsedTransaction.data ?? '0x').toLowerCase() !== data.toLowerCase()) throw new Error(`${label}.data does not match its serialized transaction`)
	const transactionValue = BigInt(unsignedIntegerString(intent['value'], `${label}.value`))
	if ((parsedTransaction.value ?? 0n) !== transactionValue) throw new Error(`${label}.value does not match its serialized transaction`)
	const mode = intent['mode']
	if (mode !== 'private' && mode !== 'public') throw new Error(`${label}.mode is invalid`)
	const status = intent['status']
	if (status !== 'confirmation-unknown' && status !== 'signed' && status !== 'submitted') {
		throw new Error(`${label}.status is invalid`)
	}
	const submissionBlock = intent['submissionBlock'] === undefined ? undefined : BigInt(unsignedIntegerString(intent['submissionBlock'], `${label}.submissionBlock`))
	const submittedAt = optionalTimestamp(intent['submittedAt'], `${label}.submittedAt`)
	const replacementHash = intent['replacementHash'] === undefined ? undefined : hash(intent['replacementHash'], `${label}.replacementHash`)
	if (replacementHash?.toLowerCase() === transactionHash.toLowerCase()) {
		throw new Error(`${label}.replacementHash must differ from the original transaction hash`)
	}
	const cancellationHash = intent['cancellationHash'] === undefined ? undefined : hash(intent['cancellationHash'], `${label}.cancellationHash`)
	if (cancellationHash?.toLowerCase() === transactionHash.toLowerCase()) {
		throw new Error(`${label}.cancellationHash must differ from the original transaction hash`)
	}
	if (cancellationHash !== undefined && replacementHash !== undefined) {
		throw new Error(`${label} cannot queue both replacement and cancellation verification`)
	}
	const recoveryBlocker = optionalString(intent['recoveryBlocker'], `${label}.recoveryBlocker`, 2_048)
	const observation = intent['observation'] === undefined ? undefined : parsePendingTransactionObservation(intent['observation'], `${label}.observation`)
	if (status === 'signed' && (submissionBlock !== undefined || submittedAt !== undefined)) throw new Error(`${label} has submission metadata before broadcast`)
	if (status !== 'signed' && (submissionBlock === undefined || submittedAt === undefined)) throw new Error(`${label} is missing submission metadata`)
	const expectation = requiredRecord(intent['semanticExpectation'], `${label}.semanticExpectation`)
	assertExactKeys(expectation, ['balanceBaselines', 'evidence', 'postconditions', 'storageBaselines'], [], `${label}.semanticExpectation`)
	if (!Array.isArray(expectation['balanceBaselines']) || expectation['balanceBaselines'].length > 256) throw new Error(`${label}.semanticExpectation.balanceBaselines must be an array with at most 256 entries`)
	const balanceBaselines = expectation['balanceBaselines'].map((candidate, baselineIndex) => {
		const baselineLabel = `${label}.semanticExpectation.balanceBaselines[${baselineIndex.toString()}]`
		const baseline = requiredRecord(candidate, baselineLabel)
		assertExactKeys(baseline, ['account', 'asset', 'balance'], [], baselineLabel)
		return {
			account: getAddress(nonemptyString(baseline['account'], `${baselineLabel}.account`)),
			asset: baseline['asset'] === 'ETH' ? ('ETH' as const) : getAddress(nonemptyString(baseline['asset'], `${baselineLabel}.asset`)),
			balance: unsignedIntegerString(baseline['balance'], `${baselineLabel}.balance`),
		}
	})
	const baselineKeys = balanceBaselines.map(baseline => `${baseline.account.toLowerCase()}:${baseline.asset === 'ETH' ? 'eth' : baseline.asset.toLowerCase()}`)
	if (new Set(baselineKeys).size !== baselineKeys.length) throw new Error(`${label}.semanticExpectation.balanceBaselines contains duplicates`)
	if (!Array.isArray(expectation['storageBaselines']) || expectation['storageBaselines'].length > 256) throw new Error(`${label}.semanticExpectation.storageBaselines must be an array with at most 256 entries`)
	const storageBaselines = expectation['storageBaselines'].map((candidate, storageIndex) => {
		const storageLabel = `${label}.semanticExpectation.storageBaselines[${storageIndex.toString()}]`
		const baseline = requiredRecord(candidate, storageLabel)
		assertExactKeys(baseline, ['args', 'contract', 'functionName', 'value'], [], storageLabel)
		return {
			args: parseStorageArguments(baseline['args'], `${storageLabel}.args`),
			contract: getAddress(nonemptyString(baseline['contract'], `${storageLabel}.contract`)),
			functionName: nonemptyString(baseline['functionName'], `${storageLabel}.functionName`, 256),
			value: nonemptyString(baseline['value'], `${storageLabel}.value`, 8_192),
		}
	})
	const storageBaselineKeys = storageBaselines.map(storageBaselineKey)
	if (new Set(storageBaselineKeys).size !== storageBaselineKeys.length) throw new Error(`${label}.semanticExpectation.storageBaselines contains duplicates`)
	const parsedEvidence = parseEvidenceArray(expectation['evidence'], `${label}.semanticExpectation.evidence`)
	for (const item of parsedEvidence) {
		if (item.kind === 'balance-change') {
			const expectedKey = `${item.account.toLowerCase()}:${item.asset === 'ETH' ? 'eth' : item.asset.toLowerCase()}`
			if (!baselineKeys.includes(expectedKey)) throw new Error(`${label}.semanticExpectation is missing a baseline for balance-change evidence ${expectedKey}`)
		}
		if (item.kind === 'storage-postcondition' && item.relation === 'changed') {
			if (item.args === undefined) throw new Error(`${label}.semanticExpectation contains changed storage evidence without arguments`)
			const expectedKey = storageBaselineKey({ args: item.args, contract: item.contract, functionName: item.functionName })
			if (!storageBaselineKeys.includes(expectedKey)) throw new Error(`${label}.semanticExpectation is missing a baseline for changed storage evidence ${expectedKey}`)
		}
	}
	const maxBlockNumber = BigInt(unsignedIntegerString(intent['maxBlockNumber'], `${label}.maxBlockNumber`))
	if (mode === 'private' && submissionBlock !== undefined && maxBlockNumber < submissionBlock) throw new Error(`${label}.maxBlockNumber precedes its submission block`)
	return {
		...(cancellationHash === undefined ? {} : { cancellationHash }),
		data,
		hash: transactionHash,
		id: identifier(intent['id'], `${label}.id`),
		label: nonemptyString(intent['label'], `${label}.label`),
		maxBlockNumber,
		mode,
		nonce,
		...(observation === undefined ? {} : { observation }),
		operationId: identifier(intent['operationId'], `${label}.operationId`),
		...(recoveryBlocker === undefined ? {} : { recoveryBlocker }),
		...(replacementHash === undefined ? {} : { replacementHash }),
		semanticExpectation: {
			balanceBaselines,
			evidence: parsedEvidence,
			postconditions: stringArray(expectation['postconditions'], `${label}.semanticExpectation.postconditions`),
			storageBaselines,
		},
		sender,
		serializedTransaction: rawTransaction,
		signedAt: timestamp(intent['signedAt'], `${label}.signedAt`),
		status,
		stepId: identifier(intent['stepId'], `${label}.stepId`),
		...(submissionBlock === undefined ? {} : { submissionBlock }),
		...(submittedAt === undefined ? {} : { submittedAt }),
		to,
		value: transactionValue,
		workflowId: identifier(intent['workflowId'], `${label}.workflowId`),
	}
}
