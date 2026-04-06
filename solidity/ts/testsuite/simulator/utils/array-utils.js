export function areEqualArrays(first, second) {
	if (first === second) return true
	if (first.length !== second.length) return false
	for (let i = 0; i < first.length; i++) {
		if (first[i] !== second[i]) return false
	}
	return true
}
export const ensureArray = value => {
	if (value === undefined) return []
	return Array.isArray(value) ? value : [value]
}
//# sourceMappingURL=array-utils.js.map
