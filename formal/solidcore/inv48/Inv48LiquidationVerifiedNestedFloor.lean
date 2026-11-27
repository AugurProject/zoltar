import Inv48LiquidationVerifiedMathLinks
import Inv48LiquidationFinish
import Inv48LiquidationGuardArithmetic
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationLibrary
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
abbrev table := Inv48.Source.model.core.table
abbrev quotient (p u : Nat) := p * 10000000 / (10000000 + u)

theorem quotientFits (p u : Nat) (hp : p<R) : quotient p u < R := by
  apply lt_of_le_of_lt _ hp
  apply (Nat.div_le_iff_le_mul (by omega : 0<10000000+u)).mpr
  calc
    p*10000000 ≤ p*(10000000+u) := Nat.mul_le_mul_left p (by omega)
    _ ≤ p*(10000000+u)+(10000000+u)-1 := by omega

/-- The actual floor helper, with the physical hoisted argument names. The
 conclusion restores the entire caller runtime before its scalar assignment. -/
theorem nestedCall (fuel : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<10000000) (enough : 12≤fuel)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (Y : r.lookupLocal? "_ic_arg_1" = some (.word 10000000))
    (D : r.lookupLocal? "_ic_arg_2" = some (.word (10000000+u))) :
    Stmt.eval (fuel+1) table c r
      (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv) =
      internalCallAssign r [Inv32FloorHoist.ret] [.word (quotient p u)] := by
  exact Inv32FloorCall.successAt table MathLinks.product MathLinks.floor
    fuel c r _ _ _ _ p 10000000 (10000000+u) hp (by native_decide)
    (by
      have big : 20000000<R := by native_decide
      omega) (by omega)
    (quotientFits p u hp) P Y D enough

/-- Invert a real successful run; no independently assumed helper execution,
 return value, or heap frame is required. -/
theorem nestedObserved (fuel : Nat) (c : Context) (r final : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<10000000) (enough : 12≤fuel)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word p))
    (Y : r.lookupLocal? "_ic_arg_1" = some (.word 10000000))
    (D : r.lookupLocal? "_ic_arg_2" = some (.word (10000000+u)))
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (fuel+1) table c r
      (.internalCall [Inv32FloorHoist.ret] Inv32Bodies.Floor.key Inv32FloorHoist.argv))
      tr (.ok (.normal final))) :
    tr = [] ∧ r.assignLocal? Inv32FloorHoist.ret (.word (quotient p u)) = some final := by
  rw [nestedCall fuel c r p u hp hu enough P Y D] at run
  simp only [internalCallAssign,List.isEmpty_cons,Bool.false_eq_true,if_false,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?] at run
  cases h : r.assignLocal? Inv32FloorHoist.ret (.word (quotient p u)) with
  | none => rw [h] at run; cases run
  | some updated =>
    rw [h] at run
    cases run
    exact ⟨rfl,rfl⟩

/-- Scalar assignment cannot modify storage, heap, allocation counters, or scratch. -/
theorem scalarFrame (r final : Runtime) (name : String) (q : Nat)
    (assigned : r.assignLocal? name (.word q) = some final) :
    {final with locals := r.locals} = r := by
  unfold Runtime.assignLocal? at assigned
  cases old : r.lookupLocal? name with
  | none => rw [old] at assigned; cases assigned
  | some v =>
    rw [old] at assigned
    cases v <;> simp only [Value.coerceLike?,Value.isMemoryObject] at assigned
    all_goals try contradiction
    all_goals repeat first | split at assigned | contradiction
    all_goals cases assigned <;> rfl

/-- Recover the returned quotient and entire non-local frame from the actual
 generated floor body run, rather than assuming a body result certificate. -/
theorem nestedBodyObserved (fuel : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<10000000) (enough : 12≤fuel)
    (tr : Interaction.Transcript) (result : Result)
    (run : Interaction.Executes (Stmt.eval fuel table c
      (Inv32FloorFastPath.scope r p 10000000 (10000000+u)) Inv32Bodies.Floor.body)
      tr (.ok result)) :
    ∃ next, tr=[] ∧ result = .returned next [.word (quotient p u)] ∧
      ∀ locals, {next with locals} = {r with locals} := by
  have hd : 10000000+u<R := by
    have big : 20000000<R := by native_decide
    omega
  obtain ⟨next,effects,ev⟩ := Inv32FloorSuccess.executionAt table MathLinks.product
    fuel c r p 10000000 (10000000+u) hp (by native_decide) hd (by omega)
    (quotientFits p u hp) enough
  rw [ev] at run
  cases run
  exact ⟨next,rfl,rfl,effects⟩
#print axioms nestedBodyObserved

#print axioms nestedCall
#print axioms nestedObserved
#print axioms scalarFrame
end LiquidationLibrary
