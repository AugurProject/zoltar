/** One entry of an allow-failure multicall after its value has been validated. */
export type OptionalReadResult<TResult> = { result: TResult; status: 'success' } | { error: Error; result?: undefined; status: 'failure' }

/** A raw allow-failure multicall entry before its value is validated. */
export type RawOptionalReadResult = { error?: unknown; result?: unknown; status: 'failure' | 'success' }

export function toReadError(error: unknown) {
	return error instanceof Error ? error : new Error('Unknown read error')
}

/** Validates that a successful read returned a bigint; `valueLabel` names the value in the failure message. */
export function toBigIntReadResult(result: RawOptionalReadResult, valueLabel: string): OptionalReadResult<bigint> {
	if (result.status === 'failure') return { error: toReadError(result.error), status: 'failure' }
	if (typeof result.result !== 'bigint') return { error: new Error(`Unexpected non-bigint ${valueLabel} value`), status: 'failure' }
	return { result: result.result, status: 'success' }
}
