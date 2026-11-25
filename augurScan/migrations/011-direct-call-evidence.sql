ALTER TABLE public.transactions
    DROP CONSTRAINT transactions_successful_log_evidence,
    ADD CONSTRAINT transactions_selection_status CHECK (((status = 'success'::text) OR ((status = 'reverted'::text) AND (COALESCE((receipt ->> 'selectionSource'::text), ''::text) = 'protocol-call'::text))));
