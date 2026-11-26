import Inv39DecimalBoundReject
import Inv39InitDecimal
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.DecimalBound
open Inv45 Inv45.Decimal

theorem decimalLength (v : Nat) (V : v<R) : (decimal v).length≤78 := by
  by_cases zero : v=0
  · subst v;decide
  · simpa only [decimal,if_neg zero,List.length_reverse] using
      lengthBound v (lt_trans V (by decide : R<10^78))

theorem linked : Inv39.model.core.table.lookup? key=some fn := (Option.some_get present).symm

theorem enter (r : Runtime) (v : Nat) :
    internalCallEnter? fn [.word v] r=some (entry {r with locals:=[]} v,r.locals) := by
  obtain ⟨g,found,ps,rs,_⟩ := Inv39.Decimal.linked
  have eq : g=fn := Option.some.inj (found.symm.trans linked)
  subst g
  unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
  rw [ps,rs]
  simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
    Ty.coerceValue?,Ty.defaultValue,entry,Runtime.withFrame,number]

theorem pureInjective {α : Type} {a b : α} (h : (pure a : SolI α)=pure b) : a=b := by
  exact Except.ok.inj (EvmCompiler.Simulation.Interaction.done.inj h)

theorem complete {α : Type} (a : α) : SolI.NoFuelStop (pure a : SolI α) := by
  constructor
  intro h
  cases h

/-- Any successful generated decimal body, at any statement fuel and with any
memory allocation limit, returns exactly the decimal bytes of its uint256 input.
No execution or output-length premise is used. -/
theorem successful (n : Nat) (t : FunctionTable) (c : Context) (r after : Runtime)
    (v : Nat) (V : v<R) (outs : List Value)
    (success : Stmt.eval n t c (entry r v) fn.body=pure (.returned after outs)) :
    ∃ out, outs=[out] ∧ Holds after (decimal v) out ∧
      after.state=r.state ∧ (decimal v).length≤78 := by
  have stable := Stmt.eval_fuel_mono (show n≤n+84 by omega)
    (table:=t) (context:=c) (runtime:=entry r v) (stmt:=fn.body)
    (by rw [success];exact complete _)
  have high : Stmt.eval (n+84) t c (entry r v) fn.body=pure (.returned after outs) := stable.trans success
  have run (ok : c.checkMemoryAllocation (reversed v).length=.ok (reversed v).length) :
      ∃ out, outs=[out] ∧ Holds after (decimal v) out ∧ after.state=r.state ∧ (decimal v).length≤78 := by
    obtain ⟨dst,out,keep,holds,exec⟩ := execution n t c r v V ok
    have same := pureInjective (exec.symm.trans high)
    cases same
    exact ⟨out,rfl,holds,keep.state,decimalLength v V⟩
  by_cases zero : v=0
  · apply run
    subst v
    simp [reversed,Context.checkMemoryAllocation,Shared.norm]
    split <;> simp_all
  · cases cap : c.checkMemoryAllocation (reversed v).length with
    | ok size =>
      have norm : Shared.norm (reversed v).length=(reversed v).length :=
        Nat.mod_eq_of_lt (lt_of_le_of_lt (lengthBound v (lt_trans V (by decide : R<10^78))) (by decide))
      have eq : size=(reversed v).length := by
        have bounded := lengthBound v (lt_trans V (by decide : R<10^78))
        have small : ¬ (reversed v).length>18446744073709551615 := by omega
        simp only [Context.checkMemoryAllocation,norm,small,↓reduceIte] at cap
        cases lim : c.memoryAllocationLimit? with
        | none => simpa only [lim,Except.ok.injEq] using cap.symm
        | some limit =>
          simp only [lim] at cap
          split at cap <;> simp_all
      subst size
      exact run cap
    | error err =>
      obtain ⟨dst,exec⟩ := executionRejected n t c r v V (Nat.pos_of_ne_zero zero) err cap
      have same := pureInjective (exec.symm.trans high)
      cases same

/-- A successful actual generated conversion always has a byte-valued result of
at most 78 bytes; byte-valuedness itself is derived, not a hypothesis. -/
theorem successfulOutput (n : Nat) (c : Context) (r after : Runtime)
    (v : Nat) (V : v<R) (outs : List Value)
    (success : Stmt.eval n Inv39.model.core.table c (entry r v) fn.body=pure (.returned after outs)) :
    ∃ out bs, outs=[out] ∧ after.derefMemoryValue out=.ok (.bytes bs) ∧
      bs.length≤78 ∧ after.state=r.state := by
  obtain ⟨out,eq,holds,same,bound⟩ := successful n _ c r after v V outs success
  refine ⟨out,decimal v,eq,?_,bound,same⟩
  cases holds with
  | direct => rfl
  | ref b cell => simp [Runtime.derefMemoryValue,cell]

theorem successfulBytes (n : Nat) (c : Context) (r after : Runtime)
    (v : Nat) (V : v<R) (outs : List Value) (bs : List Nat)
    (success : Stmt.eval n Inv39.model.core.table c (entry r v) fn.body=pure (.returned after outs))
    (bytes : ∃ out, outs=[out] ∧ after.derefMemoryValue out=.ok (.bytes bs)) : bs.length≤78 := by
  obtain ⟨out,eq,holds,_,bound⟩ := successful n _ c r after v V outs success
  obtain ⟨actual,eq',read⟩ := bytes
  have same : actual=out := by simpa [eq] using eq'.symm
  subst actual
  have decoded : after.derefMemoryValue out=.ok (.bytes (decimal v)) := by
    cases holds with
    | direct => rfl
    | ref b cell => simp [Runtime.derefMemoryValue,cell]
  have sameBytes : bs=decimal v := by rw [decoded] at read;exact (Value.bytes.inj (Except.ok.inj read)).symm
  simpa only [sameBytes] using bound

/-- The actual successful conversion supplies both length premises of the
metadata suffix rules; the concrete storage isolation theorem then preserves 7. -/
theorem metadataSuffix (n : Nat) (c : Context) (r after : Runtime)
    (v : Nat) (V : v<R) (outs : List Value) (digits : List Nat)
    (success : Stmt.eval n Inv39.model.core.table c (entry r v) fn.body=pure (.returned after outs))
    (bytes : ∃ out, outs=[out] ∧ after.derefMemoryValue out=.ok (.bytes digits))
    (base : State) (path : Init.Marker.Suffix base r.state) :
    let name := [65,117,103,117,114,32,82,101,112,117,116,97,116,105,111,110,32] ++ digits
    let symbol := [82,69,80] ++ digits
    Init.Marker.Suffix base ((after.state.storeStorageBytesAt 3 name).storeStorageBytesAt 4 symbol) ∧
    ((after.state.storeStorageBytesAt 3 name).storeStorageBytesAt 4 symbol).loadSlot 7=base.loadSlot 7 := by
  have bounds := Init.Marker.metadataLengths digits (successfulBytes n c r after v V outs digits success bytes)
  obtain ⟨_,_,_,same,_⟩ := successful n Inv39.model.core.table c r after v V outs success
  have ready : Init.Marker.Suffix base after.state := Init.Marker.Suffix.same path (congrArg State.storage same)
  have suffix := Init.Marker.Suffix.symbol _ (Init.Marker.Suffix.name _ ready bounds.1) bounds.2
  exact ⟨suffix,Init.Marker.suffixMarker suffix⟩
end Inv39.DecimalBound
