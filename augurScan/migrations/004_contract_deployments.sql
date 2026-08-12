ALTER TABLE contracts
	ADD COLUMN IF NOT EXISTS deployment_block bigint,
	ADD COLUMN IF NOT EXISTS deployment_timestamp timestamptz,
	ADD COLUMN IF NOT EXISTS deployment_block_exact boolean,
	ADD COLUMN IF NOT EXISTS deployment_checked_block bigint;

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_deployment_block_non_negative;
ALTER TABLE contracts ADD CONSTRAINT contracts_deployment_block_non_negative CHECK (deployment_block IS NULL OR deployment_block >= 0);
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_deployment_checked_block_non_negative;
ALTER TABLE contracts ADD CONSTRAINT contracts_deployment_checked_block_non_negative CHECK (deployment_checked_block IS NULL OR deployment_checked_block >= 0);
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_deployment_fields_complete;
ALTER TABLE contracts ADD CONSTRAINT contracts_deployment_fields_complete CHECK (
	(deployment_block IS NULL AND deployment_timestamp IS NULL AND deployment_block_exact IS NULL)
	OR (deployment_block IS NOT NULL AND deployment_timestamp IS NOT NULL AND deployment_block_exact IS NOT NULL)
);
