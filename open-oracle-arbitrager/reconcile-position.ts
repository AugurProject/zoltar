#!/usr/bin/env bun

import { privateKeyToAccount, type Hex } from '@zoltar/shared/ethereum'
import { loadPositionJournal, manuallyReconcilePosition, savePositionJournal } from './position-store.js'

const usage = `Close one fully investigated recovery-required position without submitting a transaction.

PRIVATE_KEY=0x... ./open-oracle-arbitrager/reconcile-position \\
  --position-file=PATH --report-id=ID --confirm-report-id=ID \\
  --evidence=TEXT --note=TEXT --external-cost-eth=ETH \\
  --final-wallet-weth=WETH --final-wallet-token=TOKEN \\
  (--realized-net-profit-eth=ETH --acknowledge-pnl-is-all-in=true |
   --pnl-unavailable=true)

The PRIVATE_KEY must belong to the position signer. Preserve a journal backup and
independent receipt/balance evidence before running this command.`

function options(arguments_: readonly string[]) {
	const parsed = new Map<string, string>()
	for (const argument of arguments_) {
		if (!argument.startsWith('--') || !argument.includes('=')) throw new Error(`Every option must use --name=value form: ${argument}`)
		const separator = argument.indexOf('=')
		const name = argument.slice(2, separator)
		const value = argument.slice(separator + 1)
		if (name === '' || value === '' || parsed.has(name)) throw new Error(`Invalid or duplicate option --${name}`)
		parsed.set(name, value)
	}
	return parsed
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
	console.log(usage)
	process.exit(0)
}

const accepted = new Set(['position-file', 'report-id', 'confirm-report-id', 'evidence', 'note', 'external-cost-eth', 'final-wallet-weth', 'final-wallet-token', 'realized-net-profit-eth', 'pnl-unavailable', 'acknowledge-pnl-is-all-in'])
const values = options(process.argv.slice(2))
for (const name of values.keys()) if (!accepted.has(name)) throw new Error(`Unknown option --${name}`)
const required = ['position-file', 'report-id', 'confirm-report-id', 'evidence', 'note', 'external-cost-eth', 'final-wallet-weth', 'final-wallet-token'] as const
for (const name of required) if (values.get(name) === undefined) throw new Error(`Missing --${name}=...`)
const pnlUnavailable = values.has('pnl-unavailable')
if (pnlUnavailable && values.get('pnl-unavailable') !== 'true') throw new Error('--pnl-unavailable must be --pnl-unavailable=true')
if (pnlUnavailable === values.has('realized-net-profit-eth')) throw new Error('Choose exactly one of --realized-net-profit-eth or --pnl-unavailable=true')
if (values.has('realized-net-profit-eth') && values.get('acknowledge-pnl-is-all-in') !== 'true') throw new Error('Recorded realized P&L requires --acknowledge-pnl-is-all-in=true')
if (pnlUnavailable && values.has('acknowledge-pnl-is-all-in')) throw new Error('--acknowledge-pnl-is-all-in applies only to recorded realized P&L')

const privateKeyValue = process.env['PRIVATE_KEY']
if (privateKeyValue === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed position signer key')
const account = privateKeyToAccount(privateKeyValue as Hex)
const positionFile = values.get('position-file')
const reportId = values.get('report-id')
if (positionFile === undefined || reportId === undefined) throw new Error('Position file and report id are required')
const positions = await loadPositionJournal(positionFile)
const index = positions.findIndex(position => position.reportId === reportId)
if (index === -1) throw new Error(`Position ${reportId} was not found`)
const position = positions[index]
if (position === undefined) throw new Error(`Position ${reportId} was not found`)
const reconciled = manuallyReconcilePosition(position, {
	confirmedReportId: values.get('confirm-report-id') ?? '',
	evidence: values.get('evidence') ?? '',
	externalCostEth: values.get('external-cost-eth') ?? '',
	finalWalletToken: values.get('final-wallet-token') ?? '',
	finalWalletWeth: values.get('final-wallet-weth') ?? '',
	note: values.get('note') ?? '',
	pnlUnavailable,
	realizedNetProfitEth: values.get('realized-net-profit-eth'),
	recordedBy: account.address,
})
const updated = [...positions]
updated[index] = reconciled
await savePositionJournal(positionFile, updated)
console.log(`report=${reportId} status=closed signer=${account.address} pnl=${reconciled.manualReconciliation?.pnlStatus ?? 'unavailable'} journal=${positionFile}`)
