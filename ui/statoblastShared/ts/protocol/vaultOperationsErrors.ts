import { hexToBytes } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'

/** RPC wrappers can hide the pool's Error(string) inside several nested data/cause records. */
export function getVaultOperationsRevertReason(failure: unknown, seen = new Set<object>()): string | undefined {
	if (typeof failure === 'string' && /^0x08c379a0[0-9a-f]+$/i.test(failure)) {
		const encoded = failure.slice(10)
		if (encoded.length < 128 || BigInt(`0x${encoded.slice(0, 64)}`) !== 32n) return undefined
		const length = Number.parseInt(encoded.slice(64, 128), 16)
		if (!Number.isSafeInteger(length) || length <= 0 || length > 4096 || encoded.length < 128 + length * 2) return undefined
		return new TextDecoder().decode(hexToBytes(`0x${encoded.slice(128, 128 + length * 2)}`))
	}
	if (!isObjectRecord(failure) || seen.has(failure)) return undefined
	seen.add(failure)
	for (const key of ['data', 'cause', 'error', 'returnData']) {
		const reason = getVaultOperationsRevertReason(failure[key], seen)
		if (reason !== undefined) return reason
	}
	const detail = getErrorDetail(failure)
	return detail?.toLowerCase().includes('unknown rpc error') === true ? undefined : detail
}
