const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const encodeOpaqueCursor = (value: unknown): string => {
	const bytes = encoder.encode(JSON.stringify(value))
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export const decodeOpaqueCursor = (value: string): unknown => {
	if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw new Error('cursor encoding')
	const unpadded = value.replace(/=+$/, '')
	const remainder = unpadded.length % 4
	if (remainder === 1) throw new Error('cursor encoding')
	const padded = unpadded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - remainder) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
	return JSON.parse(decoder.decode(bytes)) as unknown
}
