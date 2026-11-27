import Inv48LiquidationVerifiedWholeEval
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- No lower fuel assumption: replay only the observed successful path. The
require, quotient, trace and full nonlocal frame come from that same body run. -/
theorem bodyObserved (fuel : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (tail : Frame) (hp : p<R) (hu : u<R) (checked : c.checked=true)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ GuardRecovery.Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel t c (entry r p u tail)
      actualLiquidationLibraryBody) tr (.ok out)) :
    u<10000000 ∧ tr=[] ∧ out=.returned (entry r p u tail) [.word (q p u)] := by
  have promoted := LiquidationReplay.replay (Nat.le_add_right fuel 17)
    t c (entry r p u tail) actualLiquidationLibraryBody tr out run
  have good := uncertaintyFromBody (fuel+13) c r p u tail hp hu tr out ordinary promoted
  rw [bodyEval fuel c r p u tail hp good checked] at promoted
  cases promoted
  exact ⟨good,rfl,rfl⟩

#print axioms bodyObserved
end LiquidationBody
