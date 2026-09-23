-- Applied by schema:init or process startup after stopping the old app/indexer.
-- Restart with the new sources: the application source hash triggers the existing
-- projection-rebuild replay, recovering price observations omitted by discovery order.
-- Question times originate as uint48 seconds and may exceed PostgreSQL or JS dates.
-- Existing indexed dates have whole-second precision; epoch extraction is exact.
ALTER TABLE public.questions
    ALTER COLUMN start_time TYPE bigint USING EXTRACT(EPOCH FROM start_time)::bigint,
    ALTER COLUMN end_time TYPE bigint USING EXTRACT(EPOCH FROM end_time)::bigint;
