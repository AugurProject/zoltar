import { expect, test } from 'bun:test'
import { prepareDeploymentTokenTransition, replacePrimaryRepToken } from '#config/deployment-settings'
import type { Address } from '#ethereum'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

test('replaces the derived primary REP without retaining stale deployment trust', () => {
	const previousRep = address('1')
	const nextRep = address('2')
	const explicitToken = address('3')
	expect(replacePrimaryRepToken([previousRep, explicitToken, nextRep], previousRep, nextRep)).toEqual([nextRep, explicitToken])
})

test('keeps the live scan catalog unchanged while preparing restart deployment settings', () => {
	const activeRep = address('1')
	const restartRep = address('2')
	const explicitToken = address('3')
	const activeTokens = [activeRep, explicitToken]

	const transition = prepareDeploymentTokenTransition(activeTokens, undefined, activeRep, restartRep)

	expect(transition.active).toEqual([activeRep, explicitToken])
	expect(transition.restart).toEqual([restartRep, explicitToken])
})
