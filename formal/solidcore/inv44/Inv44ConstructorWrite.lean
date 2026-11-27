import Inv44Constructor
import Inv44ConstructorStorage
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv44.Constructor
structure InputRef (r : Runtime) (xs : List Nat) : Prop where
  pointer : ∃ id, r.lookupLocal? name=some (.memoryRef id) ∧ r.loadMemory? id=some (array xs)

theorem inputPointer (r : Runtime) (xs : List Nat) : InputRef (localized r xs).pushScope xs := by
  refine ⟨r.nextMemory,rfl,?_⟩
  change ((r.memory.insert r.nextMemory (array xs))[r.nextMemory]?)=_
  exact Std.HashMap.getElem?_insert_self
theorem inputWithState (r : Runtime) (s : State) (xs : List Nat) (h : InputRef r xs) : InputRef {r with state:=s} xs := ⟨h.pointer⟩
theorem value (k : Nat) (c : Context) (r : Runtime) (xs : List Nat) (input : InputRef r xs) :
    Expr.evalFuel (k+1) c r (.var name)=pure (array xs,r) := by
  obtain ⟨id,found,mem⟩ := input.pointer
  have noRef : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,found]
  rw [Expr.evalFuel,noRef,found]
  simp [Runtime.derefMemoryValue,mem,Inv08.Authority.liftPure,Inv08.Authority.bindPure]

theorem assignArray (n : Nat) (c : Context) (r : Runtime) (xs : List Nat) (fields : c.storageFields=model.core.context.storageFields)
    (empty : r.state.loadSlot 0=0) (cap : xs.length≤256) (input : InputRef r xs) :
    Stmt.eval (n+1) model.core.table c r (.assign (.storage addresses) (.var name))=
      pure (.normal {r with state:=install xs r.state}) := by
  have deref (k : Nat) : r.derefMemoryValuesWithFuel (k+1) (xs.map Value.word)=.ok (xs.map Value.word) := by
    clear cap empty input
    induction xs with
    | nil => rw [List.map_nil,Runtime.derefMemoryValuesWithFuel]
    | cons x xs ih =>
      simp only [List.map_cons,Runtime.derefMemoryValuesWithFuel,Runtime.derefMemoryValueWithFuel,ih,Bind.bind,Except.bind]
  have mat : r.storageMaterializedValue (array xs)=.ok (array xs) := by
    simp [array,Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,deref,Bind.bind,Except.bind]
  have stored : r.storeStorageFieldWithDeepClear c addresses (array xs)=.ok {r with state:=install xs r.state} := by
    unfold Runtime.storeStorageFieldWithDeepClear
    rw [fieldLookup c fields]
    simp only [Bind.bind,Except.bind,mat]
    change (do let s ← r.state.storeStorageLayoutAtWithDeepClear 0 (.dynamicArray (.scalar .address)) (array xs);pure {r with state:=s})=_
    rw [storeArray _ _ empty cap];rfl
  have resolve : (LValue.storage addresses).resolveWithRuntime c r=pure (.storageField addresses,r) := by
    change Expr.resolveLValueFuel 3 c r (.storage addresses)=_
    simp [Expr.resolveLValueFuel]
  have noRef : r.lookupStorageBase? name=none := by obtain ⟨id,h,_⟩ := input.pointer;simp [Runtime.lookupStorageBase?,h]
  have read : Expr.eval c r (.var name)=pure (array xs,r) := value 1 _ _ _ input
  rw [Stmt.eval];dsimp only
  simp only [LValue.wantsMemoryRefRhs,Bool.false_eq_true,if_false,read,noRef,Option.isSome_none]
  change (do match ← ((LValue.storage addresses).resolveWithRuntime c r).caught with
             | .ok (target,rt) => match target.write c rt (array xs) with
               | .ok updated=>pure (Result.normal updated) | .error err=>pure (Result.reverted r err)
             | .error err=>pure (Result.reverted r err))=_
  rw [resolve]
  change (match r.storeStorageFieldWithDeepClear c addresses (array xs) with
      | .ok updated=> (pure (.normal updated) : SolI Result) | .error err=>pure (.reverted r err))=_
  rw [stored]
end Inv44.Constructor
