const ignorableLogDecodeErrorNames = new Set(['AbiEventSignatureNotFoundError', 'DecodeLogDataMismatch', 'DecodeLogTopicsMismatch'])

export function isIgnorableLogDecodeError(error: unknown) {
	return error instanceof Error && ignorableLogDecodeErrorNames.has(error.name)
}
