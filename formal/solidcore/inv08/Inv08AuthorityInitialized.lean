import Inv08AuthorityExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Authority
theorem duration48 (s : State) : stored s .duration < 2^48 := by
  change Shared.norm (_ % 2^48) < 2^48
  have reduced (v : Nat) : Shared.norm (v % 2^48) = v % 2^48 :=
    Nat.mod_eq_of_lt (lt_trans (Nat.mod_lt v (by decide)) (by decide : 2^48<R))
  rw [reduced]; exact Nat.mod_lt _ (by decide)

theorem initialized (n : Nat) (c : Context) (r : Runtime)
    (fields : c.storageFields = model.core.context.storageFields) (positive : 0 < stored r.state .duration) :
    Stmt.eval (n+40) model.core.table c r initializedGuard.value = pure (.normal r) := by
  let d := stored r.state .duration
  have fit := duration48 r.state
  have dw : d<R := lt_trans fit (by decide)
  have left := Expiry.cleaned (reads c r .duration fields) fit
  have right := castBits (literal c r 0 (by decide)) 48 (by decide) (by decide) (by decide)
  have op : Source.BinaryOp.apply c.checked .ne (.word d) (.word 0) = .ok (.word 1) := by
    change (Except.ok (ε:=RevertData) (Value.word (boolWord (!wordEq d 0)))) = _
    simp [wordEq,show Shared.norm d=d from Nat.mod_eq_of_lt dw,show Shared.norm 0=0 by rfl,show d≠0 from Nat.ne_of_gt positive,boolWord]
  have val := ReleaseQuote.binary left right .ne (by intro h; cases h) (by intro h; cases h) op
  exact Inv32QuoteGuard.requireEval (n+39) model.core.table c r _ true "Fee streams not initialized" (val _ (Nat.le_succ _))

def modifierPrefix (name : String) : Option (List Source.Stmt) := do
  let fn ← model.core.table.lookup? name
  let .block parts := fn.body | none
  let some (.block [.block [caller,initialized,.captureReturn _ _]]) := parts.getLast? | none
  return [caller,initialized]
def releaseKey := "__internal_release(uint48)#[SolidCore.Solidity.Ty.uint 48]"
def addStreamKey := "__internal_addStream(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
theorem releaseGuards : modifierPrefix releaseKey = some [callerGuard.value,initializedGuard.value] :=
  (Inv32Shapes.Option_some (Inv32Shapes.seq [callerGuard,initializedGuard])).sound _ (by native_decide)
theorem fundingGuards : modifierPrefix addStreamKey = some [callerGuard.value,initializedGuard.value] :=
  (Inv32Shapes.Option_some (Inv32Shapes.seq [callerGuard,initializedGuard])).sound _ (by native_decide)
end Inv08.Authority
