import Inv48PositiveOuter
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath
namespace Inv48.PositiveRoundCore
open Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem step (n : Nat) (c : Context) (r : Runtime) (price collateral rep : Nat)
    (hp : price<R) (hr : rep<R) (positive : 0<price)
    (budget : rep * 10^18 ≤ (R-1)*price)
    (call : Stmt.eval (n+18) Inv48.Source.model.core.table c (roundStage r price collateral rep 0 0)
      (.internalCall [roundRet] Inv32Bodies.Ceil.key [.var a0,.var a1,.var a2,.var a3]) =
      internalCallAssign (roundStage r price collateral rep 0 0) [roundRet] [.word (roundedRep rep price)]) :
    Stmt.eval (n+20) Inv48.Source.model.core.table c (saved (phase2 r price collateral rep) h2 0) roundCode =
      pure (.normal (saved (phase2 r price collateral rep) h2 (roundedRep rep price))) := by
  let v := roundedRep rep price
  have fit : v<R := (rounded_fits_iff rep price positive).mpr budget
  have pre : runList c.checked (saved (phase2 r price collateral rep) h2 0).pushScope roundArgs =
      some (roundStage r price collateral rep 0 0) := by
    simp [roundArgs,runList,declare,declareZero,cleanWord,clean,Inv32Scalar.cast,localWord,literal,choice,
      enumOne,locals,h0,h1,h2,a0,a1,a2,a3,roundRet,phase2,phase1,root,start,saved,roundStage,
      Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Ty.coerceValue?,Ty.defaultValue,
      Inv32Guards.cleanupWord c.checked rep hr,Inv32Guards.cleanupWord c.checked price hp,
      projectWord]
    decide
  have H := hoist (n+18) Inv48.Source.model.core.table c (saved (phase2 r price collateral rep) h2 0)
    (roundStage r price collateral rep 0 0) (roundStage r price collateral rep 0 v)
    (roundStage r price collateral rep v v) h2 roundRet Inv32Bodies.Ceil.key roundArgs
    [.var a0,.var a1,.var a2,.var a3] v (by simp [roundArgs,listDepth,declare,declareZero]) pre call
    (by dsimp [roundStage,phase2,phase1,root,start,h0,h1,h2,a0,a1,a2,a3,roundRet]; positive_store)
    (by rfl) (by rfl) (by dsimp [roundStage,phase2,phase1,root,start,h0,h1,h2,a0,a1,a2,a3,roundRet]; positive_store)
  simpa [roundCode,roundStage,saved,Runtime.popScope,Runtime.pushScope] using H
#print axioms step
end Inv48.PositiveRoundCore
