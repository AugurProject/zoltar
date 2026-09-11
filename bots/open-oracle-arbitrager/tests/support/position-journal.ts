import { emptyPositionJournalArchive, savePositionJournalState, type PositionJournalFilesystem, type PositionRecord } from '#state/position-store'

export async function savePositionJournal(path: string, positions: readonly PositionRecord[], chainId: number, filesystem?: PositionJournalFilesystem) {
	const state = { archived: emptyPositionJournalArchive(), positions: [...positions] }
	if (filesystem === undefined) await savePositionJournalState(path, state, chainId)
	else await savePositionJournalState(path, state, chainId, filesystem)
}
