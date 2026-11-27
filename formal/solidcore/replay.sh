#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: bash formal/solidcore/replay.sh WORKDIR

In a fresh directory, fetch the pinned SolidCore source, apply the bundled diff,
build its checked interpreter, replay the arithmetic probes, and lower every
Zoltar contract from Solidity source. Safe to rerun in the same directory.
Requires Git, Python 3.10+, Bun with the repository dependencies installed,
elan with Lean 4.28.0, Forge 1.5.1, Anvil 1.5.1 and native Solidity compilers.
Set SOLC_035 and SOLC_028 to the native solc executable paths. FORGE and ANVIL
override the respective binaries on PATH. Set SOLIDCORE_JOBS to limit parallel
contract checks. Each run writes passing Lean modules under WORKDIR/models-*
and coverage to WORKDIR/contracts.tsv, then proves INV-32 through INV-36 against the emitted
harness, checks INV-37 backing inequalities and the generated pair reserve guard,
checks INV-40 threshold arithmetic and INV-44 deployment mask bits against the generated getters,
proves INV-39 child mint supply with public-call and constructor coverage and an axiom allowlist audit,
proves INV-45 scalar label uniqueness and exact endpoints through the public question-data getter,
proves INV-08 checkpoint frequency and full vesting against the capital fee stream contract,
proves the revised INV-27 oracle bounds for every uint256 input,
and checks INV-01 and INV-04 at their numeric boundaries. A failed proof, build, test or source declaration check exits nonzero.
HELP
}
if [[ ${1:-} == --help ]]; then usage; exit 0; fi
if [[ $# != 1 ]]; then usage >&2; exit 2; fi

base=6f899b80263ba63aa69b46aed4907c9e37e0b06e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
mkdir -p "$1"
work=$(cd "$1" && pwd)
sc="$work/solidity-lean"
resolve_tool() {
  local path
  path=$(command -v "$1") || { echo "Missing executable: $1" >&2; return 1; }
  realpath "$path"
}
solc35=$(resolve_tool "${SOLC_035:-solc-0.8.35}")
solc28=$(resolve_tool "${SOLC_028:-solc-0.8.28}")
forge=$(resolve_tool "${FORGE:-forge}")
anvil=$(resolve_tool "${ANVIL:-anvil}")
if [[ ! -d "$sc/.git" ]]; then
  git clone --no-checkout https://github.com/paradigmxyz/solidity-lean.git "$sc"
  git -C "$sc" checkout --detach "$base"
fi
if [[ $(git -C "$sc" rev-parse HEAD) != "$base" ]]; then
  echo "Expected SolidCore $base in $sc. Use a fresh work directory." >&2
  exit 1
fi
if git -C "$sc" apply --check "$here/solidcore.patch" 2>/dev/null; then
  git -C "$sc" apply "$here/solidcore.patch"
else
  git -C "$sc" apply --reverse --check "$here/solidcore.patch"
fi
(
  cd "$sc"
  lake build +SolidCore.Solidity.Checked:olean
  lake build +SolidCore.Witness.ConstScopeShadow:olean
  SOLC="$solc35" SOLIDCORE_ROOT="$sc" python3 "$here/test_call_types.py"
  python3 prototypes/mul512/replay.py "$repo" --solc "$solc35" --anvil "$anvil"
  python3 prototypes/source/test_assembly.py "$solc35"
  python3 prototypes/source/muldiv.py "$repo" --solc "$solc35" --anvil "$anvil"
  for probe in clone_bindings compaction creation storage_slots code_chunk byte_split code_load modexp_bytes invalid_halt calldata_word multicall scratch_call log4 guarded_delegate; do
    python3 "prototypes/source/$probe.py" "$repo" --solc "$solc35" --anvil "$anvil"
  done
  for probe in oracle_words oracle_buffer oracle_packing mapping_scratch modexp_word; do
    python3 "prototypes/source/$probe.py" "$repo" --solc "$solc35" --oracle-solc "$solc28" --anvil "$anvil"
  done
  python3 prototypes/source/discarded_bool.py --solc "$solc35" --anvil "$anvil"
  python3 prototypes/source/maturity_map.py "$repo" --solc "$solc35" --anvil "$anvil" --forge "$forge"
  models=$(mktemp -d "$work/models-XXXXXX")
  echo "Writing checked Lean source modules to $models/contracts"
  python3 "$here/check_contracts.py" --models "$models/contracts" --solidcore "$sc" --solc "$solc35" --oracle-solc "$solc28" --forge "$forge" --jobs "${SOLIDCORE_JOBS:-3}" --report "$work/contracts.tsv"
  python3 "$here/prove_inv32.py" "$models/contracts" "$sc" --with-pair --with-thresholds --with-index --with-settlement --with-streams --with-mask --with-labels --with-reputation
  if [[ ${SOLIDCORE_INV48_REPLAY:-0} == 1 ]]; then
    toolchain=$(lake env lean --print-prefix)
    python3 "$here/replay_inv48.py" --models "$models/contracts" --solidcore "$sc" --toolchain "$toolchain"
  fi
)
