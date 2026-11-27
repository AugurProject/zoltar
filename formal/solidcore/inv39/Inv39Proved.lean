import Inv39ChildMintSupply
import Inv39PublicMint
open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for theoremName in #[``Inv39.TraceEmbedding.childHeadroom,
      ``Inv39.TraceEmbedding.committedMintsFromGenesis,
      ``Inv39.TraceEmbedding.successful, ``Inv39.TraceEmbedding.mintCall_iff,
      ``Inv39.TraceEmbedding.successfulMints_sum, ``Inv39.TraceEmbedding.complete,
      ``Inv39.Child.publicMint, ``Inv39.UniversalGenesis.construct,
      ``Inv39.UniversalGenesis.deploymentBooks, ``Inv39.TraceEmbedding.checkedCoverage] do
    for dep in ← collectAxioms theoremName do
      unless allowed.contains dep do
        throwError "Unexpected INV-39 axiom {dep} in {theoremName}"
#print axioms Inv39.TraceEmbedding.childHeadroom
#print axioms Inv39.Child.publicMint
#print axioms Inv39.UniversalGenesis.construct
