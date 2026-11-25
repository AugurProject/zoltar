import { expect } from 'bun:test'
import { SQL } from 'bun'
import { assertDatabaseGenesisOutcome } from '../../src/process-bootstrap.ts'
import { postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

postgresTest('keeps distinct genesis roots out of the same database, including legacy databases', async () => {
	const sql = new SQL(requirePostgresUrl())
	try {
		await sql.begin(async transaction => {
			await transaction`CREATE TEMP TABLE indexer_runs (id bigint, network_configuration jsonb) ON COMMIT DROP`
			await transaction`CREATE TEMP TABLE networks (id text) ON COMMIT DROP`
			await assertDatabaseGenesisOutcome(transaction, 'no')
			await transaction`INSERT INTO indexer_runs VALUES (1, '[{"genesisOutcome":"no"}]')`
			await assertDatabaseGenesisOutcome(transaction, 'no')
			await expect(assertDatabaseGenesisOutcome(transaction, 'yes')).rejects.toThrow('separate PostgreSQL database')
			await transaction`UPDATE indexer_runs SET network_configuration = '[{"id":"mainnet"}]'`
			await expect(assertDatabaseGenesisOutcome(transaction, 'no')).rejects.toThrow('separate PostgreSQL database')
			await assertDatabaseGenesisOutcome(transaction, 'yes')
			await transaction`DELETE FROM indexer_runs`
			await transaction`INSERT INTO networks VALUES ('sepolia')`
			await expect(assertDatabaseGenesisOutcome(transaction, 'no')).rejects.toThrow('separate PostgreSQL database')
		})
	} finally {
		await sql.close()
	}
})
