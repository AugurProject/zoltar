type Observation = { deploymentCheckedBlock?: string | undefined; deploymentCheckedTimestamp?: string | undefined; lastScannedBlock?: string | undefined; lastScannedTimestamp?: string | undefined; lastScanAt?: string | undefined; scanning?: boolean | undefined }

function compactDuration(seconds: number) {
	if (seconds < 60) return `${seconds.toString()}s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes.toString()}m`
	const hours = Math.floor(minutes / 60)
	return hours < 24 ? `${hours.toString()}h` : `${Math.floor(hours / 24).toString()}d`
}

export function blockStatusText(snapshot: Observation | undefined, now = Date.now()) {
	const block = snapshot?.deploymentCheckedBlock ?? snapshot?.lastScannedBlock
	if (block === undefined) return 'Block — · waiting for first observation'
	const timestamp = snapshot?.deploymentCheckedTimestamp ?? snapshot?.lastScannedTimestamp
	if (timestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(timestamp)) return `Block ${block} · timestamp unavailable`
	const milliseconds = Number(timestamp) * 1_000
	if (!Number.isSafeInteger(milliseconds)) return `Block ${block} · timestamp unavailable`
	const age = compactDuration(Math.floor(Math.abs(now - milliseconds) / 1_000))
	return now >= milliseconds ? `Block ${block} · seen ${age} ago` : `Block ${block} · ${age} ahead of local clock`
}

export function scanStatusText(snapshot: Observation) {
	if (snapshot.deploymentCheckedBlock !== undefined) return `Deployments checked at block ${snapshot.deploymentCheckedBlock}`
	if (snapshot.lastScanAt !== undefined) return `Last scan ${new Date(snapshot.lastScanAt).toLocaleString()}`
	return snapshot.scanning ? 'Scanning configured pools…' : 'Waiting for first scan'
}
