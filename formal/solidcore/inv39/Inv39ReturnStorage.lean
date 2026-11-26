import Inv39Frame
open SolidCore.Solidity.Source
namespace Inv39.Frame
mutual
theorem memoryStorage (r : Runtime) (v : Value) : (r.memoryStoredValue v).1.state.storage=r.state.storage := by
  cases v <;> first | rfl | exact memoryListStorage _ _
termination_by sizeOf v
theorem memoryListStorage (r : Runtime) (vs : List Value) : (r.memoryStoredValues vs).1.state.storage=r.state.storage := by
  cases vs with
  | nil => rfl
  | cons v vs =>
    rw [Runtime.memoryStoredValues]; dsimp only; split
    · exact (memoryListStorage _ vs).trans (memoryStorage _ _)
    · exact memoryListStorage _ vs
termination_by sizeOf vs
end
theorem rawStorage (r q : Runtime) (name : String) (v : Value) (write : r.assignLocalRaw? name v=some q) : q.state.storage=r.state.storage := by
  unfold Runtime.assignLocalRaw? at write
  split at write <;> first | cases write; rfl | contradiction
theorem localStorage (r q : Runtime) (name : String) (v : Value) (write : r.assignLocal? name v=some q) : q.state.storage=r.state.storage := by
  unfold Runtime.assignLocal? at write
  split at write
  · split at write
    · exact rawStorage _ _ _ _ write
    · split at write
      · exact (rawStorage _ _ _ _ write).trans (memoryStorage _ _)
      · contradiction
  · split at write
    · split at write <;> first | cases write; rfl | contradiction
    · contradiction
  · contradiction
theorem assignRef (r q : Runtime) (name : String) (v : Value) (write : r.assignLocalRefAware? name v=some q) : q.state.storage=r.state.storage := by
  unfold Runtime.assignLocalRefAware? at write
  split at write <;> first | exact localStorage _ _ _ _ write | skip
  all_goals
    unfold Runtime.assignStorageRefValue? at write
    split at write <;> first | contradiction | skip
    all_goals split at write <;> first | cases write; rfl | contradiction
theorem namedStorage (r q : Runtime) (targets : List String) (values : List Value) (write : r.assignNamedValuesRef? targets values=some q) : q.state.storage=r.state.storage := by
  induction targets generalizing values r with
  | nil => cases values <;> first | cases write; rfl | contradiction
  | cons k ks ih =>
    cases values with
    | nil => contradiction
    | cons v vs =>
      simp only [Runtime.assignNamedValuesRef?] at write; split at write
      · rename_i mid step
        exact (ih _ _ write).trans (assignRef _ _ _ _ step)
      · contradiction
theorem targetsStorage (r : Runtime) (targets : List String) (values : List Value) :
    Ensures (internalCallAssign r targets values) (fun res => res.runtime.state.storage=r.state.storage) := by
  unfold internalCallAssign
  split <;> first | exact pureValue (P:=fun res : Result => res.runtime.state.storage=r.state.storage) _ rfl | skip
  split
  · rename_i mid eq; exact pureValue (P:=fun res : Result => res.runtime.state.storage=r.state.storage) (.normal mid) (namedStorage _ _ _ _ eq)
  · exact pureValue (P:=fun res : Result => res.runtime.state.storage=r.state.storage) _ rfl
theorem finishStorage (f : InternalFunction) (targets : List String) (saved : LocalEnv) (res : Result) :
    Ensures (internalCallFinish f targets saved res) (fun out => out.runtime.state.storage=res.runtime.state.storage) := by
  cases res <;> simp only [internalCallFinish]
  all_goals first | exact pureValue (P:=fun res : Result => res.runtime.state.storage=_) _ rfl | skip
  all_goals split <;> first
    | exact targetsStorage _ _ _
    | exact pureValue (P:=fun res : Result => res.runtime.state.storage=_) _ rfl
end Inv39.Frame
