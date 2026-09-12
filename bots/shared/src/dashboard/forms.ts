export function urlLines(value: string) {
	return value
		.split('\n')
		.map(line => line.trim())
		.filter(line => line !== '')
}
