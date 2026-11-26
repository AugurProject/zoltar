import Inv39PlainFrames
open SolidCore.Solidity.Source
namespace Inv39.Frame
mutual
theorem storeValue (base : State) (r : Runtime) (v : Value) (prior : region base r) :
    region base (r.memoryStoredValue v).1 := by
  cases v <;> first
    | exact prior
    | exact storeValues base r _ prior
termination_by sizeOf v
theorem storeValues (base : State) (r : Runtime) (vs : List Value) (prior : region base r) :
    region base (r.memoryStoredValues vs).1 := by
  cases vs with
  | nil => exact prior
  | cons v vs =>
    rw [Runtime.memoryStoredValues]; dsimp only
    split
    · exact storeValues _ _ _ (storeValue base r v prior)
    · exact storeValues _ _ _ prior
termination_by sizeOf vs
end
theorem memoryCell (base : State) (r next : Runtime) (id : Nat) (v : Value) (prior : region base r)
    (ok : r.storeMemory? id v=some next) : region base next := by
  unfold Runtime.storeMemory? at ok
  split at ok
  · cases ok; exact storeValue _ _ _ prior
  · contradiction
theorem memoryDecl (base : State) (r next : Runtime) (name : String) (v : Value) (ty : Ty) (prior : region base r)
    (ok : r.declareMemoryLocal ty name v=some next) : region base next := by
  unfold Runtime.declareMemoryLocal at ok
  cases got : ty.coerceValue? v with
  | none => simp [got] at ok
  | some value =>
    simp only [got,Option.bind_some] at ok; cases ok
    exact declared base _ _ _ (by trivial) (storeValue base _ _ prior)
theorem memoryLocalize (base : State) (r next : Runtime) (name : String) (ty : Ty) (prior : region base r)
    (ok : r.localizeMemoryLocal ty name=some next) : region base next := by
  unfold Runtime.localizeMemoryLocal at ok
  split at ok
  · cases ok; exact prior
  · rename_i v hv _
    cases got : ty.coerceValue? v with
    | none => simp [got] at ok
    | some value =>
      simp only [got,Option.bind_some] at ok
      apply rawAssigned _ _ _ _ _ _ _ ok
      · trivial
      · exact storeValue base r value prior
  · contradiction
def incoming : Value → Prop | .word _ | .fixedBytes _ _ | .bytes _ | .memoryRef _ => True | _ => False
theorem localAssigned (base : State) (r next : Runtime) (name : String) (v : Value) (safe : incoming v)
    (before : region base r) (ok : r.assignLocal? name v=some next) : region base next := by
  unfold Runtime.assignLocal? at ok
  cases h : r.lookupLocal? name with
  | none => simp [h] at ok
  | some old =>
    have good := envLookup _ _ _ before.2 h
    rw [h] at ok
    cases old <;> first | contradiction | skip
    case memoryRef id =>
      cases v <;> first | contradiction | skip
      all_goals simp only [Value.isMemoryObject,Bool.false_eq_true,if_false,if_true,Runtime.memoryStoredValue] at ok
      all_goals first
        | contradiction
        | apply rawAssigned _ _ _ _ _ _ _ ok <;> first | trivial | exact before
    all_goals
      cases v <;> first | contradiction | skip
      all_goals simp only [Value.coerceLike?] at ok
      all_goals first | contradiction | skip
      all_goals
        split at ok
        · rename_i l written; cases ok; exact ⟨before.1,envAssign _ _ _ _ before.2 (by trivial) written⟩
        · contradiction
end Inv39.Frame
