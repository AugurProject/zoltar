import Inv08AddStreamGuards
import Inv08AddStreamWrites
import Inv08AddStreamRecord
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.AddStream
open ExpiryStorage

theorem incrementId (n : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (id : Nat) (current : stored r.state .latest=id) (fit : id+1<2^48) :
    increment.value.eval (n+1) model.core.table c r =
      pure (.normal {r with state:=r.state.storeFieldWord Field.latest.field (id+1)}) := by
  have fits : id+1<R := lt_trans fit (by decide)
  have lookup : c.storageField? Field.latest.name=some Field.latest.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fieldLookup _
  have load : r.loadStorageField c Field.latest.name = .ok (.word id) := by
    unfold Runtime.loadStorageField; rw [lookup,← current]; rfl
  have read : (ResolvedLValue.storageField Field.latest.name).read c r = .ok (.word id) := by
    simp [ResolvedLValue.read,ResolvedLValue.readRaw,load,Bind.bind,Except.bind,Runtime.derefMemoryValue]
  have clean : (ValueCleanup.uint 48).apply c.checked (.word (id+1)) = .ok (.word (id+1)) := Expiry.cleanValue _ _ fit
  have op := Inv40.addWords c.checked id 1 fits
  have write := resolvedWrite c r .latest (id+1) fits lookup fields
  have act : (ResolvedLValue.storageField Field.latest.name).applyIncDecCleanup c r .add false (.uint 48) =
      .ok (.word (id+1),{r with state:=r.state.storeFieldWord Field.latest.field (id+1)}) := by
    unfold ResolvedLValue.applyIncDecCleanup; rw [read]
    simp only [Bind.bind,Except.bind,Value.oneLike?,op,clean,write]; rfl
  apply exprStmt
  change Expr.evalFuel 4 c r (.incDec .add false (some (.uint 48)) (.storage Field.latest.name)) = _
  rw [Expr.evalFuel]; simp only [Expr.resolveLValueFuel,Authority.bindPure,act]; rfl

theorem differentTest (c : Context) (r : Runtime) (prev : Record) (endAt : Nat) (memory : Snapshot r prev)
    (found : r.lookupLocal? "end"=some (.word endAt)) (pf : prev.endAt<2^48) (ef : endAt<2^48) :
    different.value.eval c r=pure (.word (boolWord (decide (prev.endAt≠endAt))),r) := by
  have old := member c r prev 0 prev.endAt memory (by decide) rfl
  have L : Expr.evalFuel 7 c r (.castOp .uintCleanup 48 (Integral.member "previous" 0).value)=pure (.word prev.endAt,r) := by
    rw [Expr.evalFuel,old 6 (by decide)]
    simp only [Authority.bindPure,Expiry.cleanValue _ _ pf]; rfl
  have right := Expiry.local48 c r "end" endAt ef found 7 (by decide)
  have test := Inv32Eval.binary 7 c r .ne (by intro h;cases h) (by intro h;cases h) _ _ _ _ _ L right
    (neRead c _ _ (lt_trans pf (by decide)) (lt_trans ef (by decide)))
  by_cases equal : prev.endAt=endAt <;> simpa only [equal,ne_eq,not_true_eq_false,
    if_pos,if_neg,decide_true,decide_false,boolWord] using test

theorem chooseId (n : Nat) (c : Context) (r : Runtime) (prev : Record) (id endAt : Nat) (memory : Snapshot r prev)
    (found : r.lookupLocal? "end"=some (.word endAt)) (pf : prev.endAt<2^48) (ef : endAt<2^48)
    (fields : c.storageFields=model.core.context.storageFields) (current : stored r.state .latest=id)
    (fits : id+(if prev.endAt=endAt then 0 else 1)<2^48) :
    appendId.value.eval (n+2) model.core.table c r = pure (.normal
      (if prev.endAt=endAt then r else {r with state:=r.state.storeFieldWord Field.latest.field (id+1)})) := by
  have b := Inv32Blocks.branch (n+1) model.core.table c r different.value increment.value .skip _ (differentTest c r prev endAt memory found pf ef)
  change Stmt.eval _ _ _ _ (.ifElse different.value increment.value .skip) = _
  rw [b]
  by_cases eqn : prev.endAt=endAt
  · simp only [eqn,ne_self_iff_false,decide_false,Bool.false_eq_true,if_false,if_true]
    rw [Stmt.eval]
  · simp only [eqn,ne_eq,not_false_eq_true,decide_true,if_true,if_false] at fits ⊢
    exact incrementId n c r fields id current fits

theorem storeTuple (n : Nat) (c : Context) (r : Runtime) (id : Nat) (e : Record)
    (fields : c.storageFields=model.core.context.storageFields) (current : stored r.state .latest=id) (fit : id<2^48)
    (rhs : Expr.eval c r (.tuple FundingRecord.expected.value)=pure (.tuple e.words,r)) :
    store.value.eval (n+1) model.core.table c r =
      pure (.normal {r with state:=install r.state (mappingStorageSlot 7 id) e}) := by
  let idx := (field48 .latest).value
  have key := Expiry.scalarField c r .latest id fields current fit
  change Inv40.Reads c r idx id at key
  have resolved : (LValue.storageIndex "expiries" idx).resolveWithRuntime c r=pure (.storageIndex "expiries" (.word id),r) := by
    change Expr.resolveLValueFuel 6 c r (.storageIndex "expiries" idx)=_
    change (do let (v,s) ← Expr.evalFuel 5 c r idx; pure (ResolvedLValue.storageIndex "expiries" v,s)) = _
    rw [key 5 (by decide)]; rfl
  change Stmt.eval _ _ _ _ (.assign (.storageIndex "expiries" idx) (.tuple FundingRecord.expected.value))=_
  rw [Stmt.eval]; dsimp only
  simp only [LValue.wantsMemoryRefRhs,Bool.false_eq_true,if_false,rhs]
  change (do match ← ((LValue.storageIndex "expiries" idx).resolveWithRuntime c r).caught with
             | .ok (target,r') => match target.write c r' (.tuple e.words) with
               | .ok updated => pure (Result.normal updated)
               | .error err => pure (Result.reverted r err)
             | .error err => pure (Result.reverted r err))=_
  rw [resolved]
  change (match r.storeStorageIndexWithDeepClear c "expiries" (.word id) (.tuple e.words) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  rw [storeRecord c r id (lt_trans fit (by decide)) e fields]
end Inv08.AddStream
