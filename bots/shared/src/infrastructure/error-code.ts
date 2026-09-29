/** The string `code` of a Node system error, or undefined for any other thrown value. */
function errorCode(error: unknown) {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

export function isErrorCode(error: unknown, ...codes: readonly string[]) {
	const code = errorCode(error)
	return code !== undefined && codes.includes(code)
}
