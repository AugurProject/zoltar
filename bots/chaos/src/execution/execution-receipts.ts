import type { Hex } from '@zoltar/bot-shared/ethereum'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { readReceiptOrMissing, receiptEvidence } from '@zoltar/bot-shared/execution/receipt-quorum'
import { availableSettledValues, quorumValue, settledQuorumValue, sharedQuorumBlockNumber } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { type ExecutionEnvironment, assertRequestedTransactionHash } from './execution-context.ts'
import { requiredConnectivity, agreedLatestBlock, canonicalAttestingReaders } from './execution-quorum.ts'

export async function includedReceiptWithQuorum(environment: ExecutionEnvironment, hash: Hex) {
	const connectivity = requiredConnectivity(environment.settings)
	const inclusionAnchor = await agreedLatestBlock(environment, `receipt ${hash} inclusion anchor`)
	const readers = canonicalAttestingReaders(environment, `receipt ${hash} inclusion`, inclusionAnchor.attestingRpcUrls)
	const settledObservations = await Promise.allSettled(
		readers.map(async reader => {
			const receipt = await readReceiptOrMissing(reader.client, hash)
			if (receipt !== undefined) assertRequestedTransactionHash(receipt.transactionHash, hash, `RPC ${reader.endpoint} receipt lookup`)
			return {
				head: await reader.client.getBlockNumber(),
				reader,
				receipt,
			}
		}),
	)
	const observations = availableSettledValues(settledObservations)
	if (observations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`receipt ${hash} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints with head evidence`)
	}
	// Heads sampled alongside the receipt lookups cannot precede an observed inclusion block, unlike the earlier anchor.
	const head = sharedQuorumBlockNumber(
		observations.map(observation => observation.head),
		connectivity.rpcQuorum,
	)
	const receiptObservations = observations.flatMap(({ reader, receipt }) => {
		if (receipt === undefined) return []
		return [{ endpoint: reader.endpoint, receipt, value: receiptEvidence(receipt) }]
	})
	if (receiptObservations.length === 0) {
		return { head, includedBlock: undefined, observed: false as const, receipt: undefined }
	}
	if (receiptObservations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`receipt ${hash} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints with matching receipt evidence`)
	}
	const evidence = quorumValue(
		`receipt ${hash}`,
		receiptObservations.map(({ endpoint, value }) => ({ endpoint, value })),
		connectivity.rpcQuorum,
	)
	const capableObservations = observations.flatMap(observation => {
		if (observation.head < evidence.blockNumber) {
			if (observation.receipt === undefined) return []
			throw new Error(`RPC disagreement for receipt ${hash}: ${observation.reader.endpoint} returned a receipt at block ${evidence.blockNumber.toString()} above its reported head ${observation.head.toString()}`)
		}
		if (observation.receipt === undefined) {
			throw new Error(`RPC disagreement for receipt ${hash}: ${observation.reader.endpoint} reported head ${observation.head.toString()} but could not find the receipt at block ${evidence.blockNumber.toString()}`)
		}
		return [observation]
	})
	if (capableObservations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`receipt ${hash} requires ${connectivity.rpcQuorum.toString()} capable RPC endpoints`)
	}
	const receipt = receiptObservations.find(candidate => candidate.value.blockHash.toLowerCase() === evidence.blockHash.toLowerCase() && candidate.value.blockNumber === evidence.blockNumber && candidate.value.hash.toLowerCase() === evidence.hash.toLowerCase())?.receipt
	if (receipt === undefined) throw new Error(`Receipt ${hash} quorum evidence is missing its source receipt`)
	const canonicalHash = await settledQuorumValue(
		`receipt ${hash} inclusion ancestry`,
		capableObservations.map(async observation => {
			const before = await observation.reader.client.getBlock({ blockNumber: receipt.blockNumber })
			const after = await observation.reader.client.getBlock({ blockNumber: receipt.blockNumber })
			if (before.number !== receipt.blockNumber || after.number !== receipt.blockNumber || before.hash === undefined || after.hash?.toLowerCase() !== before.hash.toLowerCase()) throw new Error(`Receipt ${hash} block changed during inclusion verification`)
			return { endpoint: observation.reader.endpoint, value: before.hash.toLowerCase() }
		}),
		connectivity.rpcQuorum,
	)
	if (canonicalHash !== receipt.blockHash.toLowerCase()) throw new Error(`Receipt ${hash} is no longer canonical`)
	const accepted =
		environment.finalityBlocks === undefined ||
		(await confirmCanonicalReceiptFinality(
			capableObservations.map(observation => observation.reader.client),
			capableObservations.map(observation => observation.reader.endpoint),
			`transaction ${hash}`,
			receipt,
			environment.finalityBlocks,
			undefined,
			connectivity.rpcQuorum,
		))
	return { head, includedBlock: receipt.blockNumber, observed: true as const, receipt: accepted ? receipt : undefined }
}
