const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })

export function poolDatePresentation(timestamp: string | undefined) {
	if (timestamp === undefined || !/^\d+$/.test(timestamp)) return undefined
	const seconds = BigInt(timestamp)
	if (seconds > 8_640_000_000_000n) return undefined
	const date = new Date(Number(seconds) * 1000)
	return { dateTime: date.toISOString(), text: `${dateFormatter.format(date)} UTC` }
}
