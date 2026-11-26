import Inv08InitializeGuards
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies Inv32FloorStart
namespace Inv08.Initialize
open Authority
theorem ledgerOK (n : Nat) (c : Context) (r : Runtime) (size : (bytes c r).length=65)
    (nz : prefixWord (bytes c r) 20≠0) :
    Stmt.eval (n+40) model.core.table c r Initialize.ledger.value = pure (.normal (post c r)) := by
  let work := r.pushScope
  let dest := localsAt work ledgerRet 0 0
  let v := prefixWord (bytes c r) 20
  let got := (post c work).declareLocal tmp (.word v)
  let finish := got.declareLocal viewName (.word v)
  have fit := prefixWordBound (bytes c r) 20 (by decide)
  have call := viaExec (n+36) c work false v (ledgerCall (n+4) c dest [ledgerRet] size)
  have z := zeroAdr (n+38) c work tmp
  have saved := Inv32Hoist.declEval (n+38) model.core.table c got viewName .address (.var tmp) v
    (Inv32Guards.readWord _ _ _ _ _ rfl) (by rw [Ty.coerceValue?])
  have cond := ReleaseQuote.binary (localReads c finish viewName v rfl) (literal c finish 0 (by decide)) .ne
    (by intro h; cases h) (by intro h; cases h) (AddStream.neRead c v 0 fit (by decide))
  rw [if_neg (show v≠0 from nz)] at cond
  have good := AddStream.requireHolds (n+38) c finish _ "Invalid fee authority" cond
  have nilStep : Stmt.evalList (n+39) model.core.table c finish []=pure (.normal finish) := by rw [Stmt.evalList]
  exact Inv32Hoist.block (n+39) model.core.table c r finish _ ((seqStep _ _ _ _ _ _ _ z).trans
    ((seqStep _ _ _ _ _ _ _ call).trans ((seqStep _ _ _ _ _ _ _ saved).trans
      ((seqStep _ _ _ _ _ _ _ good).trans nilStep))))

end Inv08.Initialize
