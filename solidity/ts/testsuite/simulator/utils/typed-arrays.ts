
export function areEqualArrays<T>(first: T[], second: T[]) {
	if (first === second) return true
	if (first.length !== second.length) return false
	for (let i = 0; i < first.length; i++) {
		if (first[i] !== second[i]) return false
	}
	return true
}

