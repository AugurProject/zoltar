import { isRecord } from './api-validation.ts'
import { exactUnit } from './format.ts'

export const escalationPayoutSummary = (position: Readonly<Record<string, unknown>>): string => {
	const amount = (key: string) => exactUnit(typeof position[key] === 'string' ? position[key] : undefined, 18, 'REP')
	const status = String(position['status'] ?? 'unavailable').replaceAll('-', ' ')
	const parts = [`${position['kind'] === 'inherited' ? 'Inherited' : 'Local'} · ${status}`, `${amount('principal_atto_rep')} original principal`]
	if (position['kind'] === 'inherited' && position['source_principal_atto_rep'] !== undefined) parts.push(`${amount('source_principal_atto_rep')} source principal`)
	if (position['retained_principal_atto_rep'] !== undefined) parts.push(`${amount('retained_principal_atto_rep')} retained`, `${amount('auction_haircut_atto_rep')} latest auction haircut`)
	if (position['payout_atto_rep'] !== undefined) parts.push(`${amount('payout_atto_rep')} payable to claim bundle`, `${amount('burn_atto_rep')} protocol burn allocation`)
	return parts.join(' · ')
}

export const claimProofDisclosure = (position: Readonly<Record<string, unknown>>, block: unknown, blockHash: unknown): HTMLDetailsElement => {
	const details = document.createElement('details')
	details.className = 'operations-raw-evidence'
	const title = document.createElement('summary')
	title.textContent = isRecord(position['proof']) ? 'View membership and unspent proof' : 'View payout calculation evidence'
	const evidence = document.createElement('pre')
	evidence.textContent = JSON.stringify({ block, blockHash, ...position }, null, 2)
	details.append(title, evidence)
	return details
}

export const escalationPayoutTitle = (position: Readonly<Record<string, unknown>>): string => `${['INVALID', 'YES', 'NO'][Number(position['outcome'])] ?? 'Unknown outcome'} · Deposit ${position['deposit_index']}`
