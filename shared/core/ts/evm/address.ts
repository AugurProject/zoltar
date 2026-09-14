export function sameAddress(left: string | undefined, right: string | undefined) {
	return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase()
}
