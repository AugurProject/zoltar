ALTER TABLE public.chain_reorganizations
    ADD COLUMN occurrence_counts jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Backfill once during the schema upgrade, rather than on every API request.
WITH counts AS (
    SELECT invalidation_id, occurrence_kind, count(*)::text AS occurrence_count
    FROM public.history_invalidation_occurrences
    GROUP BY invalidation_id, occurrence_kind
), summaries AS (
    SELECT invalidation_id, jsonb_object_agg(occurrence_kind, occurrence_count) AS occurrence_counts
    FROM counts GROUP BY invalidation_id
)
UPDATE public.chain_reorganizations reorganization
SET occurrence_counts = summaries.occurrence_counts
FROM summaries WHERE summaries.invalidation_id = reorganization.id;
