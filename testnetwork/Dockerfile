FROM ghcr.io/foundry-rs/foundry:v1.5.1@sha256:3a70bfa9bd2c732a767bb60d12c8770b40e8f9b6cca28efc4b12b1be81c7f28e

EXPOSE 8545

ENTRYPOINT ["anvil"]
CMD ["--host", "0.0.0.0", "--port", "8545", "--chain-id", "11155111", "--hardfork", "osaka", "--block-time", "1", "--block-base-fee-per-gas", "0", "--gas-price", "0", "--no-priority-fee"]
