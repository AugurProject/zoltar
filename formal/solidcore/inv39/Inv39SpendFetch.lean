import Inv39SpendShape
import Inv39AllowanceGetter
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Allowance
def hoist (r : Runtime) (v : Nat) := r.pushScope.declareLocal tmp (.word v)
def staged (r : Runtime) (o s prior val : Nat) :=
  (((hoist r prior).pushScope.declareLocal "_ic_arg_0" (.word o)).declareLocal "_ic_arg_1" (.word s)).declareLocal retGet (.word val)
macro "write_get" : tactic => `(tactic| simp [staged,hoist,tmp,retGet,Runtime.lookupLocal?,Runtime.assignLocal?,Runtime.pushScope,
    Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?, *])
theorem getRun (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (O : r.lookupLocal? "owner"=some (.word o))
    (S : r.lookupLocal? "spender"=some (.word s)) (fields : c.storageFields=model.core.context.storageFields)
    (atSlot : r.state.loadSlot (slot o s)=v) (fit : v<R) :
    Stmt.eval (n+6) model.core.table c (hoist r 0) getCall.value=pure (.normal (hoist r v)) := by
  let t := model.core.table
  let enter := (hoist r 0).pushScope
  let one := enter.declareLocal "_ic_arg_0" (.word o)
  let two := one.declareLocal "_ic_arg_1" (.word s)
  have owner := Inv32Hoist.declEval (n+4) t c enter "_ic_arg_0" .address (.var "owner") o (Inv32Guards.readWord _ _ _ _ _ O) rfl
  have spender := Inv32Hoist.declEval (n+4) t c one "_ic_arg_1" .address (.var "spender") s (Inv32Guards.readWord _ _ _ _ _ S) rfl
  have decl := Inv32FloorStart.zero (n+4) t c two retGet
  have get := getterCall n c (staged r o s 0 0) [retGet] o s v "_ic_arg_0" "_ic_arg_1" rfl rfl fields atSlot fit
  have cap := Inv32Hoist.takeReturn _ _ _ _ (staged r o s 0 v) _ _ _ _ get (by write_get)
  have copy := Inv32Hoist.lastCopy (n+4) t c (staged r o s 0 v) (staged r o s v v) tmp retGet 0 v (by write_get) (by write_get) (by write_get)
  exact Inv32Hoist.block _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ owner).trans ((seqStep _ _ _ _ _ _ _ spender).trans
    ((seqStep _ _ _ _ _ _ _ decl).trans ((seqStep _ _ _ _ _ _ _ cap).trans copy))))
end Inv39.Allowance
