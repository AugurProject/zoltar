import { exportRequestScope, parseExportValidationState, verifyExportPage } from '../src/export-verification.ts'

const [headerPath, bodyPath, dataset, chainId, canonical, fromBlock, toBlock, previousPath, requestCursor] = process.argv.slice(2)
if (
	headerPath === undefined ||
	bodyPath === undefined ||
	dataset === undefined ||
	chainId === undefined ||
	canonical === undefined ||
	fromBlock === undefined ||
	toBlock === undefined ||
	(previousPath === undefined) !== (requestCursor === undefined) ||
	process.argv.length > 11
)
	throw new Error(
		'Usage: bun scripts/verify-export-page.ts <headers> <ndjson-body> <dataset> <chain-id> <canonical> <from-block> <to-block> [previous-validation.json request-cursor]',
	)

const scope = exportRequestScope(dataset, chainId, canonical, fromBlock, toBlock)
const previous = previousPath === undefined ? undefined : parseExportValidationState(JSON.parse(await Bun.file(previousPath).text()))
const state = verifyExportPage(await Bun.file(headerPath).text(), await Bun.file(bodyPath).text(), scope, previous, requestCursor)
process.stdout.write(`${JSON.stringify(state)}\n`)
