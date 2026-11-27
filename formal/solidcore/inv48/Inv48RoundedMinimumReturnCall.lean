import Inv48MinimumRepOperandPublic
import Inv48QuoteWideBoundsRounded
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RoundedMinimumReturn
open Inv48.Positive Inv48.MinimumSuffixPath Inv48.MinimumRepOperand
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

macro "round_locals" : tactic => `(tactic|
  simp [roundCaller,roundStage,phase2,phase1,root,start,saved,h0,h1,h2,a0,a1,a2,a3,roundRet,
    Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,
    LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])

theorem call (path : Path n c r trace out) (s : Rounded path)
    (repEq : path.rep = repPost post base p C R)
    (hp : p < Inv32Division.R) (hr : R < Inv32Division.R) (positive : 0<p) :
    Inv03.ceilQuot (R*10^18) p < Inv32Division.R ∧
    Stmt.eval (n+33) Inv48.Source.model.core.table c s.caller roundCall =
      internalCallAssign s.caller [roundRet] [.word (Inv03.ceilQuot (R*10^18) p)] := by
  have eq := roundedCaller path s repEq hp hr
  have A : s.caller.lookupLocal? a0 = some (.word R) := by rw [eq]; round_locals
  have B : s.caller.lookupLocal? a1 = some (.word (10^18)) := by rw [eq]; round_locals
  have P : s.caller.lookupLocal? a2 = some (.word p) := by rw [eq]; round_locals
  have O : s.caller.lookupLocal? a3 = some (.word 1) := by rw [eq]; round_locals
  have run := Inv48.CollateralCloneFuel.replay (show n+1 ≤ n+33 by omega) _ _ _ _ _ _ s.callRun
  have fit := Inv48.QuoteWideBounds.roundedFits n c s.caller a0 a1 a2 a3 [roundRet]
    R (10^18) p true hr (by decide) hp positive A B P O _ _ run (by intro mid err h; cases h)
  have ceil := Inv48.QuoteExecMath.roundedCeil R (10^18) p positive
  refine ⟨by rwa [ceil] at fit, ?_⟩
  have ev := Inv48.FeedMath.roundedCall (n+15) c s.caller a0 a1 a2 a3 [roundRet]
    R (10^18) p true hr (by decide) hp positive fit A B P O
  rwa [ceil] at ev

#print axioms call
end Inv48.RoundedMinimumReturn
