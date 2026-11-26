import Inv39ChildGo
import Inv39Authority
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Child
def enter (r : Runtime) (a v : Nat) := r.withFrame [("account",.word a),("valueAttoRep",.word v)]
/-- Both public methods run their accounting body inside the same Zoltar-only modifier. -/
theorem wrapAuthorized (k : Kind) (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (a v : Nat)
    (fit : v<R) (senderFit : c.sender<R) (fields : c.immutableFields=model.core.context.immutableFields)
    (authorized : r.state.immutable? "zoltar"=some (.word c.sender)) (next : Runtime)
    (body : Stmt.eval (n+1) t c (enter r a v).pushScope.pushScope.pushScope (effects k).value = pure (.normal next)) :
    Stmt.eval (n+5) t c (enter r a v) (shape k).value = pure (.normal next.popScope.popScope.popScope) := by
  let start := enter r a v
  let outer := start.pushScope
  let middle := outer.pushScope
  let inner := middle.pushScope
  have guard := Inv39.authorized c t inner (n+1) fields senderFit authorized
  have call := Inv32Internal.capture (n+1) t c inner next [] _ body
  have modBlock := Inv32Hoist.block (n+2) t c middle next _ ((seqStep _ _ _ _ _ _ _ guard).trans
    ((seqStep _ _ _ _ _ _ [] call).trans (show Stmt.evalList (n+2) t c next []=pure (.normal next) by rw [Stmt.evalList])))
  have group := Inv32Blocks.one _ _ _ _ _ _ modBlock
  have skip : Stmt.eval (n+4) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec (n+3) t c outer "valueAttoRep" v fit rfl (by dsimp [outer,start,enter]; write_param)
  apply Inv32Hoist.block
  exact (seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ param).trans ((seqStep _ _ _ _ _ _ [] group).trans
    (show Stmt.evalList (n+4) t c next.popScope.popScope []=pure (.normal next.popScope.popScope) by rw [Stmt.evalList])))
end Inv39.Child
