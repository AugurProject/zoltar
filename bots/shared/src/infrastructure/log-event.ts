export type BotName = 'arbitrager' | 'chaos' | 'liquidator'

/**
 * `info` is routine progress, `warning` a skipped or degraded step the bot tolerates and retries on its own, and
 * `error` a failure that blocks progress or needs the operator.
 */
export type LogLevel = 'error' | 'info' | 'warning'

export type LogFields = Readonly<Record<string, bigint | boolean | number | string | undefined>>

function logValue(value: bigint | boolean | number | string) {
	const text = String(value)
	return text === '' || /[\s"=]/.test(text) ? JSON.stringify(text) : text
}

/** One `key=value` line: the bot and event first, then every defined field in order. Values with spaces are quoted. */
function formatLogEvent(bot: BotName, event: string, fields: LogFields = {}) {
	const pairs = Object.entries(fields).flatMap(([key, value]) => (value === undefined ? [] : [`${key}=${logValue(value)}`]))
	return [`bot=${bot}`, `event=${event}`, ...pairs].join(' ')
}

/** Writes one structured operator log line at `level`; `info` goes to stdout, warnings and errors to stderr. */
export function logEvent(bot: BotName, event: string, fields: LogFields = {}, level: LogLevel = 'info') {
	const line = formatLogEvent(bot, event, fields)
	if (level === 'error') console.error(line)
	else if (level === 'warning') console.warn(line)
	else console.log(line)
}
