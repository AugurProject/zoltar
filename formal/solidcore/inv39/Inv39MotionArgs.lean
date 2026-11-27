import Inv39Movement
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Motion
private abbrev arg0 := "_ic_arg_0"
private abbrev arg1 := "_ic_arg_1"
private abbrev arg2 := "_ic_arg_2"
def stageA (r : Runtime) (a : Nat) := r.pushScope.declareLocal arg0 (.word a)
def stageB (r : Runtime) (a b : Nat) := (stageA r a).declareLocal arg1 (.word b)
def stageC (r : Runtime) (a b v : Nat) := (stageB r a b).declareLocal arg2 (.word v)
theorem invokeUpdate (n : Nat) (c : Context) (r : Runtime) (k : Kind) (src dst val : Nat)
    (x : (sender k).value.eval c r.pushScope = pure (.word src,r.pushScope))
    (y : (receiver k).value.eval c (stageA r src) = pure (.word dst,stageA r src))
    (qty : r.lookupLocal? "value" = some (.word val)) (sBound : src<2^160) (dBound : dst<2^160) (vWord : val<R)
    (debit : ERC20.fromBounds r.state src val) (credit : ERC20.toBounds (ERC20.afterFrom r.state src val) dst val)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+10) model.core.table c r (argsBlock k).value = pure (.normal next) ∧
      next.locals = r.locals ∧ next.state.storage = (ERC20.afterTo (ERC20.afterFrom r.state src val) dst val).storage := by
  let t := model.core.table
  let a := stageA r src
  let b := stageB r src dst
  let ready := stageC r src dst val
  have xv := Inv32Hoist.declEval (n+8) t c r.pushScope arg0 .address _ src x (by rfl)
  have yv := Inv32Hoist.declEval (n+8) t c a arg1 .address _ dst y (by rfl)
  have z : (Inv03.Bodies.wvar "value").value.eval c b = pure (.word val,b) :=
    Inv32Guards.clean _ _ _ _ _ vWord (Inv32Guards.readWord _ _ _ _ _ qty)
  have zv := Inv32Hoist.declEval (n+8) t c b arg2 .uint256 _ val z (by rfl)
  obtain ⟨endR,called,frame,st⟩ := ERC20.updateCall n c ready src dst val arg0 arg1 arg2 rfl rfl rfl
    sBound dBound vWord debit credit fields events
  have cap := Inv32Internal.capture _ t c ready endR [] _ called
  refine ⟨endR.popScope,?_,?_,st⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ xv).trans ((seqStep _ _ _ _ _ _ _ yv).trans ((seqStep _ _ _ _ _ _ _ zv).trans
      ((seqStep _ _ _ _ _ _ [] cap).trans (show Stmt.evalList (n+9) t c endR [] = pure (.normal endR) by rw [Stmt.evalList]))))
  · change endR.locals.drop 1 = r.locals
    rw [frame]; rfl
end Inv39.Motion
