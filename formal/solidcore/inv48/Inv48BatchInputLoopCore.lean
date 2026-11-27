import Inv48OperationsWrapperArgsLoop
import Inv48ReportingGuardFrameFrozen
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchInputLoop
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def Inputs (r : Runtime) (p a b : Nat) (batch : Value) : Prop :=
  r.lookupLocal? "proposedRepPerEthPrice" = some (.word p) ∧
  r.lookupLocal? "requestedInitialAttoWeth" = some (.word a) ∧
  r.lookupLocal? "bountyAttoEth" = some (.word b) ∧
  r.lookupLocal? "batch" = some batch

theorem frameLookup (f g : Frame) (name other : String) (v : Value)
    (different : other ≠ name) (write : f.assign? name v = some g) :
    g.lookup? other = f.lookup? other := by
  induction f generalizing g with
  | nil => simp [Frame.assign?] at write
  | cons pair tail ih =>
    rcases pair with ⟨key,old⟩
    simp only [Frame.assign?] at write
    split at write
    next eq =>
      cases write
      simp [Frame.lookup?,eq,Ne.symm different]
    next ne =>
      cases assigned : Frame.assign? tail name v with
      | none => simp [assigned] at write
      | some updated =>
        simp only [assigned,Option.some.injEq] at write
        cases write
        simp only [Frame.lookup?]
        split
        · rfl
        · exact ih updated assigned

theorem frameMissing (f : Frame) (name : String) (v : Value)
    (missing : f.assign? name v = none) : f.lookup? name = none := by
  induction f with
  | nil => rfl
  | cons pair tail ih =>
    rcases pair with ⟨key,old⟩
    simp only [Frame.assign?] at missing
    split at missing
    · contradiction
    next ne =>
      cases assigned : Frame.assign? tail name v with
      | some updated => simp [assigned] at missing
      | none => simp [Frame.lookup?,ne,ih assigned]

theorem envLookup (f g : LocalEnv) (name other : String) (v : Value)
    (different : other ≠ name) (write : f.assign? name v = some g) :
    g.lookup? other = f.lookup? other := by
  induction f generalizing g with
  | nil => simp [LocalEnv.assign?] at write
  | cons head tail ih =>
    simp only [LocalEnv.assign?] at write
    cases first : head.assign? name v with
    | some updated =>
      simp only [first,Option.some.injEq] at write
      cases write
      simp only [LocalEnv.lookup?,frameLookup head updated name other v different first]
    | none =>
      simp only [first] at write
      cases second : LocalEnv.assign? tail name v with
      | none => simp [second] at write
      | some updated =>
        simp only [second,Option.some.injEq] at write
        cases write
        simp only [LocalEnv.lookup?]
        cases head.lookup? other <;> simp [ih updated second]

theorem scalarWrite (r final : Runtime) (name other : String) (old : Nat)
    (value : Value) (bound : r.lookupLocal? name = some (.word old))
    (different : other ≠ name) (write : r.assignLocal? name value = some final) :
    final.lookupLocal? other = r.lookupLocal? other := by
  simp only [Runtime.assignLocal?,bound] at write
  cases coerced : (Value.word old).coerceLike? value with
  | none => simp [coerced] at write
  | some v =>
    simp only [coerced] at write
    cases assigned : r.locals.assign? name v with
    | none => simp [assigned] at write
    | some locals =>
      simp only [assigned,Option.some.injEq] at write
      cases write
      exact envLookup r.locals locals name other v different assigned

theorem writeInputs (r final : Runtime) (p a b old : Nat) (batch value : Value)
    (name : String) (allowed : name = "index" ∨ name = "requiredGas")
    (bound : r.lookupLocal? name = some (.word old))
    (write : r.assignLocal? name value = some final) (inputs : Inputs r p a b batch) :
    Inputs final p a b batch := by
  have keep (other : String) (different : other ≠ name) :=
    scalarWrite r final name other old value bound different write
  rcases allowed with rfl | rfl <;>
    simpa only [Inputs,keep "proposedRepPerEthPrice" (by decide),
      keep "requestedInitialAttoWeth" (by decide),keep "bountyAttoEth" (by decide),
      keep "batch" (by decide)] using inputs

/-- Empty lexical scopes preserve all four original bindings, including an
arbitrary batch reference. No materialization or batch decoding is assumed. -/
theorem pushInputs (r : Runtime) (p a b : Nat) (batch : Value) :
    Inputs r.pushScope p a b batch ↔ Inputs r p a b batch := by
  rfl

end Inv48.BatchInputLoop
