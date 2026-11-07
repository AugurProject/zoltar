export function claimStateChanged(message: string) {
	return Object.assign(new Error(message), { claimStateChanged: true })
}
