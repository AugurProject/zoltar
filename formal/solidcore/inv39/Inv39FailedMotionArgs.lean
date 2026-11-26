import Inv39MotionArgs
import Inv39FailedUpdate
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Motion
private abbrev arg0 := "_ic_arg_0"
private abbrev arg1 := "_ic_arg_1"
private abbrev arg2 := "_ic_arg_2"
theorem invokeFailedUpdate (n : Nat) (c : Context) (r : Runtime) (k : Kind) (src dst val : Nat)
    (x : (sender k).value.eval c r.pushScope = pure (.word src,r.pushScope))
    (y : (receiver k).value.eval c (stageA r src) = pure (.word dst,stageA r src))
    (qty : r.lookupLocal? "value" = some (.word val)) (sBound : src<2^160) (vWord : val<R)
    (nz : src≠0) (low : r.state.loadSlot (balanceSlot src)<val)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+10) model.core.table c r (argsBlock k).value = pure (.reverted next ERC20.lowFunds) := by
  let t := model.core.table
  let a := stageA r src
  let b := stageB r src dst
  let ready := stageC r src dst val
  have xv := Inv32Hoist.declEval (n+8) t c r.pushScope arg0 .address _ src x (by rfl)
  have yv := Inv32Hoist.declEval (n+8) t c a arg1 .address _ dst y (by rfl)
  have z : (Inv03.Bodies.wvar "value").value.eval c b = pure (.word val,b) :=
    Inv32Guards.clean _ _ _ _ _ vWord (Inv32Guards.readWord _ _ _ _ _ qty)
  have zv := Inv32Hoist.declEval (n+8) t c b arg2 .uint256 _ val z (by rfl)
  obtain ⟨endR,called⟩ := ERC20.failedUpdateCall n c ready src dst val arg0 arg1 arg2 rfl rfl rfl (lt_trans sBound (by decide)) nz low vWord fields
  have cap := Inv32Revert.capture _ t c ready endR _ [] _ called
  exact ⟨endR.popScope,Inv32Revert.blockRevert _ t c r endR _ _ ((seqStep _ _ _ _ _ _ _ xv).trans ((seqStep _ _ _ _ _ _ _ yv).trans
      ((seqStep _ _ _ _ _ _ _ zv).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ cap))))⟩
end Inv39.Motion
