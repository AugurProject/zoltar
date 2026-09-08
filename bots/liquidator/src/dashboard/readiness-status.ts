type Readiness = {
	operatorCapable: boolean
	paused: boolean
	scanning?: boolean | undefined
	execute: boolean
	wallet?: string | undefined
	lastScanAt?: string | undefined
	lastScannedBlock?: string | undefined
	deploymentMissingName?: string | undefined
	deploymentCheckedBlock?: string | undefined
}

type Guidance = { pending: boolean; message: string; label?: string; title?: string }

export function readinessGuidance(snapshot: Readiness, hasDetailedBlockers: boolean): Guidance | undefined {
	if (snapshot.operatorCapable !== false || hasDetailedBlockers) return undefined
	if (snapshot.paused) return { pending: false, message: 'The bot is paused. Use Resume to continue scanning.' }
	if (snapshot.deploymentMissingName !== undefined && snapshot.deploymentCheckedBlock !== undefined)
		return { pending: true, label: 'Not deployed', title: 'Waiting for deployment', message: `${snapshot.deploymentMissingName} is not deployed at block ${snapshot.deploymentCheckedBlock}. The bot rechecks automatically and will scan pools once the required contracts are deployed.` }
	if (snapshot.scanning) return { pending: true, label: 'Scanning pools', title: 'Scan in progress', message: 'Status updates automatically when the scan completes.' }
	if (snapshot.execute && snapshot.wallet === undefined) return { pending: false, message: 'Live execution needs an active signer. Open Settings and configure Execution signer.' }
	if (snapshot.lastScanAt === undefined || snapshot.lastScannedBlock === undefined) return { pending: true, label: 'Awaiting first scan', title: 'Waiting for scan', message: 'The first scan has not completed. Status updates automatically as the bot checks the chain and configured pools.' }
	return { pending: false, message: 'The operator is not ready. Status updates automatically; inspect the bot logs if it remains blocked.' }
}
