export const parseRpcRequestBody = (value: unknown): { readonly id: number | string | null; readonly method: string; readonly params?: readonly unknown[] } => {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('method' in value) || typeof value.method !== 'string' || !('id' in value)) throw new Error('Unexpected RPC request')
	if (value.id !== null && typeof value.id !== 'number' && typeof value.id !== 'string') throw new Error('Unexpected RPC request ID')
	if ('params' in value && value.params !== undefined && !Array.isArray(value.params)) throw new Error('Unexpected RPC request parameters')
	return { id: value.id, method: value.method, ...('params' in value && Array.isArray(value.params) ? { params: value.params } : {}) }
}
