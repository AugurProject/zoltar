import Inv39InitState
import Inv39ReturnStorage
open SolidCore.Solidity.Source
namespace Inv39.Init
mutual
theorem memoryEnv (r : Runtime) (v : Value) : (r.memoryStoredValue v).1.locals=r.locals := by
  cases v <;> first | rfl | exact memoryEnvs _ _
termination_by sizeOf v
theorem memoryEnvs (r : Runtime) (vs : List Value) : (r.memoryStoredValues vs).1.locals=r.locals := by
  cases vs with
  | nil => rfl
  | cons v vs =>
    rw [Runtime.memoryStoredValues]; dsimp only; split
    · exact (memoryEnvs _ vs).trans (memoryEnv _ _)
    · exact memoryEnvs _ vs
termination_by sizeOf vs
end
theorem memoryValue (b : State) (r : Runtime) (v : Value) (h : region b r) : region b (r.memoryStoredValue v).1 :=
  ⟨unchanged h.1 (Frame.memoryStorage r v),by simpa only [memoryEnv] using h.2⟩
theorem memoryDecl (base : State) (r next : Runtime) (name : String) (v : Value) (ty : Ty) (prior : region base r)
    (ok : r.declareMemoryLocal ty name v=some next) : region base next := by
  unfold Runtime.declareMemoryLocal at ok
  cases got : ty.coerceValue? v with
  | none => simp [got] at ok
  | some value =>
    simp only [got] at ok; cases ok
    exact declared base _ _ _ (by trivial) (memoryValue base _ _ prior)
theorem localAssigned (base : State) (r next : Runtime) (name : String) (v : Value)
    (before : region base r) (ok : r.assignLocal? name v=some next) : region base next := by
  unfold Runtime.assignLocal? at ok
  split at ok
  · split at ok
    · apply rawAssigned _ _ _ _ _ _ _ ok <;> first | trivial | exact before
    · split at ok
      · apply rawAssigned _ _ _ _ _ _ _ ok
        · trivial
        · exact memoryValue _ _ _ before
      · contradiction
  · rename_i old _ lookup
    have valid := envLookup _ _ _ before.2 lookup
    split at ok
    · rename_i coerced got
      split at ok
      · rename_i locals write; cases ok
        exact ⟨before.1,envAssign _ _ _ _ before.2 (coerceTemplate old v coerced valid got) write⟩
      · contradiction
    · contradiction
  · contradiction
theorem assignPointerFails (r : Runtime) (name : String) (v : Value) (before : safeEnv r.locals) : r.assignStorageRefValue? name v=none := by
  unfold Runtime.assignStorageRefValue?
  cases eq:r.lookupLocal? name with
  | none => rfl
  | some old =>
    have h := envLookup _ _ _ before eq
    cases old <;> first | rfl | contradiction
theorem assignRef (base : State) (r next : Runtime) (name : String) (v : Value) (prior : region base r)
    (ok : r.assignLocalRefAware? name v=some next) : region base next := by
  unfold Runtime.assignLocalRefAware? at ok
  split at ok <;> first | exact localAssigned _ _ _ _ _ prior ok | rw [assignPointerFails _ _ _ prior.2] at ok; contradiction
theorem namedRef (base : State) (r next : Runtime) (ks : List String) (vs : List Value) (prior : region base r)
    (ok : r.assignNamedValuesRef? ks vs=some next) : region base next := by
  induction ks generalizing vs r with
  | nil => cases vs <;> first | cases ok; exact prior | contradiction
  | cons k ks ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      simp only [Runtime.assignNamedValuesRef?] at ok; split at ok
      · rename_i mid step; exact ih _ _ (assignRef _ _ _ _ _ prior step) ok
      · contradiction
theorem namedPlain (base : State) (r next : Runtime) (ks : List String) (vs : List Value) (prior : region base r)
    (ok : r.assignNamedValues? ks vs=some next) : region base next := by
  induction ks generalizing vs r with
  | nil => cases vs <;> first | cases ok; exact prior | contradiction
  | cons k ks ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      simp only [Runtime.assignNamedValues?] at ok; split at ok
      · rename_i mid step; exact ih _ _ (localAssigned _ _ _ _ _ prior step) ok
      · contradiction
end Inv39.Init
