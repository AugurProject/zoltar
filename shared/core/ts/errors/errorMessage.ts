/** Human-readable message for an unknown thrown value. */
export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
