import Inv27Wrapper
import Inv27Counterexample
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv27

/-- Observable result of calling one of the two source-generated oracle price helpers through the public harness. -/
def observe (s : State) (cons : Bool) (p e : Nat) : Option Answer := do
  let res ← TypeCheck.CheckedContract.call? 50000 Inv03.model (.name (apiName cons)) s (Harness.args p e)
  match res with
  | .returned _ [.word v] => some (Answer.value v)
  | .reverted _ (.error msg) => some (Answer.error msg)
  | _ => none

private theorem resolved (cons : Bool) (p e : Nat) :
    Inv03.model.core.resolveCallFunction? (.name (apiName cons)) (Harness.args p e) = some (Harness.fn cons) := by
  have found : Inv03.model.core.findFunctionByName? (apiName cons) = some (Harness.fn cons) := (Option.some_get _).symm
  obtain ⟨ok,before,after,parts,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,parts,?_⟩
  · simp [ok,Harness.frameOk]
  · intro fn mem
    have absent := skip fn mem
    simp_all

theorem publicQuote (s : State) (cons : Bool) (p e : Nat) (hp : p<R) (he : e<R) :
    observe s cons p e = some (quote cons p e) := by
  let c := CheckedWordCall.ctx Inv03.model
  let r := CheckedWordCall.initial c s
  let start := r.withFrame (frame p e)
  let fn := Harness.fn cons
  have entry : fn.evalBodyEntry 50000 table c s (Harness.args p e) = some (Source.Stmt.eval 50000 table c start fn.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos (Harness.accepts cons),Harness.frameOk]; rfl
  have ev : Harness.Satisfies (Source.Stmt.eval 50000 table c start fn.body) start (quote cons p e) :=
    Harness.execute 49973 c r p e hp he cons
  unfold observe TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch? Source.ABI.Contract.callWithSelfDispatch
  rw [resolved]
  change (do let result ← fn.call? 50000 table c s (Harness.args p e)
             match result with
             | .returned _ [.word v] => some (Answer.value v)
             | .reverted _ (.error msg) => some (Answer.error msg)
             | _ => none) = _
  unfold FunctionDef.call? FunctionDef.call
  rw [entry]
  cases Q : quote cons p e with
  | value v =>
    rw [Q] at ev
    change Source.Stmt.eval 50000 table c start fn.body = pure (.returned start [.word v]) at ev
    rw [ev]
    have result : fn.callBodyResult s (.returned start [.word v]) =
        .returned {start.state with constructorOutput? := none} [.word v] := by
      simp [fn,FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,Harness.returns,Inv32Internal.wordBindings,
        coerceReturnBindings,coerceReturnBindings.coerce,Ty.coerceValue?,Runtime.derefMemoryValueDeep,
        Runtime.derefMemoryValueWithFuel,Bind.bind,Except.bind,Value.untagFixedBytes]
    change (match fn.callBodyResult s (.returned start [.word v]) with
      | .returned _ [.word v] => some (Answer.value v)
      | .reverted _ (.error msg) => some (Answer.error msg) | _ => none) = _
    rw [result]
  | error msg =>
    rw [Q] at ev
    obtain ⟨next,ev⟩ := ev
    rw [ev]; rfl

theorem outward (s : State) (p e f : Nat) (hp : p<R) (widen : e≤f) (valid : f<D)
    (representable : p≤maximum f) :
    observe s false p f = some (Answer.value (lower p f)) ∧ observe s false p e = some (Answer.value (lower p e)) ∧
    observe s true p e = some (Answer.value (upper p e)) ∧ observe s true p f = some (Answer.value (upper p f)) ∧
    lower p f ≤ lower p e ∧ upper p e ≤ upper p f := by
  have eok := lt_of_le_of_lt widen valid
  have wide := wider p e f widen valid
  have bounds := (fits_iff p e eok).mp (wide.2.trans ((fits_iff p f valid).mpr representable))
  simp only [publicQuote s _ p e hp (lt_trans eok (by decide)),publicQuote s _ p f hp (lt_trans valid (by decide))]
  simp [quote, Nat.not_le_of_gt eok, Nat.not_le_of_gt valid, Nat.not_lt.mpr bounds,
    Nat.not_lt.mpr representable,wide]

theorem noUncertainty (s : State) (p : Nat) (hp : p<R) :
    observe s false p 0 = some (Answer.value p) ∧ observe s true p 0 = some (Answer.value p) := by
  have m : maximum 0=M := by simp [maximum]
  have bound : p≤maximum 0 := by rw [m]; change p≤R-1; omega
  simp [publicQuote _ _ p 0 hp (by decide),quote, Nat.not_lt.mpr bound,(zero p).1,(zero p).2]

theorem fundedPriceBound (rep collateral : Nat) (cap : rep < 2^128) :
    rep*10^18/collateral ≤ (2^128-1)*10^18 :=
  (Nat.div_le_self _ _).trans (Nat.mul_le_mul_right _ (by omega))

theorem funded (s : State) (rep collateral e : Nat) (cap : rep<2^128) (positive : 0<collateral) (valid : e<D) :
    let p := rep*10^18/collateral
    observe s true p e = some (Answer.value (upper p e)) ∧ observe s false p e = some (Answer.value (lower p e)) := by
  let p := rep*10^18/collateral
  have scaled : p*D<R := Inv27Source.fundedNumeratorFits _ _ cap positive
  have hp : p<R := lt_of_le_of_lt (Nat.le_mul_of_pos_right p (by decide : 0<D)) scaled
  have ok : p≤maximum e := by
    apply (fits_iff p e valid).mp
    apply (Inv03.ceil_le _ _ _ (by omega : 0<D-e)).mpr
    exact le_trans (by change p*D≤R-1; omega) (Nat.le_mul_of_pos_right M (by omega : 0<D-e))
  dsimp only
  change observe s true p e = _ ∧ observe s false p e = _
  simp [publicQuote _ _ _ _ hp (lt_trans valid (by decide)),quote,Nat.not_le_of_gt valid,Nat.not_lt.mpr ok]
  exact ⟨rfl,rfl⟩
end Inv27

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv27.publicQuote,``Inv27.fits_iff,``Inv27.outward,``Inv27.noUncertainty,``Inv27.fundedPriceBound,``Inv27.funded] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-27 axiom {dep}"
