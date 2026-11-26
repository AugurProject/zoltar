import Inv08AuthorityCall
open SolidCore.Solidity.Source Inv03.Bodies Inv32FloorStart
namespace Inv08.Authority
def whichRet (bound : Bool) := if bound then bindingRet else ledgerRet
def localsAt (r : Runtime) (slot : String) (v out : Nat) :=
  ((r.declareLocal tmp (.word v)).pushScope).declareLocal slot (.word out)
theorem zeroAdr (n : Nat) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (n+1) model.core.table c r (.varDecl .address name none) = pure (.normal (r.declareLocal name (.word 0))) := by
  rw [Stmt.eval]; dsimp only; rw [Ty.defaultValue]

theorem viaExec (n : Nat) (c : Context) (r : Runtime) (bound : Bool) (v : Nat)
    (called : let rt := localsAt r (whichRet bound) 0 0
      Stmt.eval (n+1) model.core.table c rt (.internalCall [whichRet bound] (boundFnKey bound) []) =
        internalCallAssign (post c rt) [whichRet bound] [.word v]) :
    Stmt.eval (n+3) model.core.table c (r.declareLocal tmp (.word 0)) (via (whichRet bound) (boundFnKey bound)).value =
      pure (.normal ((post c r).declareLocal tmp (.word v))) := by
  let slot := whichRet bound
  let src := localsAt r slot 0 0
  let written := localsAt (post c r) slot 0 v
  let doneR := localsAt (post c r) slot v v
  have put : (post c src).assignLocal? slot (.word v)=some written := by
    cases bound <;> cases H : r.locals <;> simp [src,written,slot,whichRet,localsAt,post,bytes,Runtime.allocMemory,
      Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,
      LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?,H]
  have callee : Stmt.eval (n+1) model.core.table c src (.internalCall [slot] (boundFnKey bound) []) = pure (.normal written) := by
    rw [called]; change internalCallAssign (post c src) [slot] [.word v] = _
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,put]
  have cap := Inv32Internal.capture _ _ _ _ _ [slot] _ callee
  have cp : Stmt.evalList (n+2) model.core.table c written [.assign (.var tmp) (.var slot)] = pure (.normal doneR) := by
    apply Inv32Hoist.lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases bound <;> cases H : r.locals <;>
      simp [doneR,written,slot,localsAt,whichRet,post,bytes,Runtime.allocMemory,tmp,Inv32CeilFlags.h0,
        Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,
        LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?,H,show ledgerRet≠"_sol_hoist_0" by decide,show bindingRet≠"_sol_hoist_0" by decide]
  have decl := zeroAdr (n+1) c (r.declareLocal tmp (.word 0)).pushScope slot
  exact Inv32Hoist.block _ _ _ _ doneR _ ((seqStep _ _ _ _ _ _ _ decl).trans ((seqStep _ _ _ _ _ _ _ cap).trans cp))

theorem ledger (n : Nat) (c : Context) (r : Runtime) (size : (bytes c r).length=65) :
    Stmt.eval (n+32) model.core.table c r ledgerBody.value =
      pure (.returned (post c r) [.word (prefixWord (bytes c r) 20)]) := by
  let work := r.pushScope.pushScope
  let dest := localsAt work bindingRet 0 0
  let v := prefixWord (bytes c r) 20
  let fin := (post c work).declareLocal tmp (.word v)
  have b := boundCall n c dest [bindingRet] size
  have call := viaExec (n+27) c work true v b
  have look : fin.lookupLocal? tmp = some (.word v) := by rfl
  have read : Expr.evalReturnValue c fin (.var tmp) = pure (.word v,fin) := by
    simp only [Expr.evalReturnValue,Runtime.lookupMemoryRef?,look]
    exact Inv32Guards.readWord _ _ _ _ _ look
  have ret := Inv32CompareValues.retOne (n+29) model.core.table c fin _ v read
  have z := zeroAdr (n+29) c work tmp
  have mid := Inv32FloorFastPath.blockReturned (n+30) model.core.table c r.pushScope fin _ _
    ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ _ call).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ ret)))
  have sk : Stmt.eval (n+31) model.core.table c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  exact Inv32FloorFastPath.blockReturned _ _ _ _ fin.popScope _ _ ((seqStep _ _ _ _ _ _ _ sk).trans
    (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ mid))

theorem ledgerCall (n : Nat) (c : Context) (r : Runtime) (targets : List String) (size : (bytes c r).length=65) :
    Stmt.eval (n+33) model.core.table c r (.internalCall targets ledgerKey []) =
      internalCallAssign (post c r) targets [.word (prefixWord (bytes c r) 20)] := by
  let src := fresh r false
  let out := post c src
  let val := prefixWord (bytes c r) 20
  have ev := ledger n {c with checked:=true} src size
  change Stmt.eval _ _ _ src ledgerBody.value = pure (.returned out [.word val]) at ev
  have bd : (fn false).body = ledgerBody.value := fnBody false
  rw [←bd] at ev
  have found : model.core.table.lookup? ledgerKey = some (fn false) := (Option.some_get _).symm
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ [] _ _ _ (by rfl) found (enters r false) ev]
  have values : coerceReturnBindingsRef (fn false).returns out [.word val] = .ok [.word val] := by
    rw [(signature false).2]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,retDecl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,values]
  rfl
end Inv08.Authority
