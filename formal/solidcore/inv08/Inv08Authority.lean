import Inv08AuthorityLedger
import Inv08AuthorityInitialized
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies Inv32FloorStart
namespace Inv08.Authority

/-- A correctly bound clone passes the generated caller check. The helper allocates one temporary
byte array in interpreter memory and leaves persistent storage and the caller's local frame intact. -/
theorem authorized (n : Nat) (c : Context) (r : Runtime) (clone : Clone c r) :
    Stmt.eval (n+40) model.core.table c r callerGuard.value = pure (.normal (post c r)) := by
  let work := r.pushScope
  let dest := localsAt work ledgerRet 0 0
  let v := prefixWord (bytes c r) 20
  let got := (post c work).declareLocal tmp (.word v)
  let finish := got.declareLocal "#view274" (.word v)
  have fit := prefixWordBound (bytes c r) 20 (by decide)
  have call := viaExec (n+36) c work false v (ledgerCall (n+4) c dest [ledgerRet] clone.1)
  have z := zeroAdr (n+38) c work tmp
  have saved := Inv32Hoist.declEval (n+38) model.core.table c got "#view274" .address (.var tmp) v
    (Inv32Guards.readWord _ _ _ _ _ rfl) (by rw [Ty.coerceValue?])
  have callerRead : Inv40.Reads c finish .caller v := by
    intro f enough
    cases f with
    | zero => change 1≤0 at enough; omega
    | succ f => rw [Expr.evalFuel]; rw [clone.2]
  have cond := ReleaseQuote.binary callerRead (localReads c finish "#view274" v rfl) .eq
    (by intro h; cases h) (by intro h; cases h) (Inv32WideGuards.eqWord c.checked v v fit fit)
  simp only [if_pos rfl] at cond
  have good := Inv32QuoteGuard.requireEval (n+38) model.core.table c finish _ true "Only capital ledger" (cond _ (Nat.le_succ _))
  have nilStep : Stmt.evalList (n+39) model.core.table c finish []=pure (.normal finish) := by rw [Stmt.evalList]
  exact Inv32Hoist.block (n+39) model.core.table c r finish _ ((seqStep _ _ _ _ _ _ _ z).trans
    ((seqStep _ _ _ _ _ _ _ call).trans ((seqStep _ _ _ _ _ _ _ saved).trans
      ((seqStep _ _ _ _ _ _ _ good).trans nilStep))))

theorem postState (c : Context) (r : Runtime) : (post c r).state = r.state := rfl
theorem postLocals (c : Context) (r : Runtime) : (post c r).locals = r.locals := rfl

theorem onlyCapitalLedger (n : Nat) (c : Context) (r : Runtime) (tail : List Stmt) (clone : Clone c r)
    (fields : c.storageFields = model.core.context.storageFields) (positive : 0 < stored r.state .duration) :
    Stmt.evalList (n+40) model.core.table c r (callerGuard.value :: initializedGuard.value :: tail) =
      Stmt.evalList (n+40) model.core.table c (post c r) tail :=
  (seqStep _ _ _ _ _ _ _ (authorized n c r clone)).trans (seqStep _ _ _ _ _ _ _ (initialized n c (post c r) fields positive))
end Inv08.Authority

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv08.Authority.onlyCapitalLedger,``Inv08.Authority.releaseGuards,``Inv08.Authority.fundingGuards] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected fee-stream authority axiom {dep}"
