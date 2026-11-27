import Inv48EscrowPrefixShape
import Inv48EscrowPrefixPull
open SolidCore.Solidity.Source
open EvmCompiler.Simulation
namespace Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- Inversion of the actual lowered Collateral.pull statement's complete open
    tree. The temporary input bindings are the call's four arguments. No
    payer/repAmount/escrow preservation is assumed, and no callee body or reply
    is assumed pure or successful. -/
theorem actualPullPreservesEveryLocal (fuel : Nat) (c : Context) (r final : Runtime)
    (a b d e : Nat)
    (A : r.lookupLocal? "_ic_arg_0" = some (.word a))
    (B : r.lookupLocal? "_ic_arg_1" = some (.word b))
    (D : r.lookupLocal? "_ic_arg_2" = some (.word d))
    (E : r.lookupLocal? "_ic_arg_3" = some (.word e))
    (stmt : Stmt) (actual : actualPullLast = some stmt)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (fuel+2) Inv48.Source.model.core.table c r stmt)
      trace (.normal final)) :
    ∀ name, final.lookupLocal? name = r.lookupLocal? name := by
  have equal : stmt = pullCall := by rw [actualPull] at actual; exact Option.some.inj actual.symm
  subst stmt
  have locals := capturedInternalNormal fuel Inv48.Source.model.core.table c r pullKey pullArgs
    [.word a,.word b,.word d,.word e] (fourScalarArgs c r a b d e A B D E)
    trace final run
  intro name
  simp only [Runtime.lookupLocal?,locals]

#print axioms actualPullPreservesEveryLocal
end Inv48.EscrowPrefix
