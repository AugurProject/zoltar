import Inv39InitDescriptors
import Inv39InitMemory
import Inv39InputReads
open SolidCore.Solidity.Source
namespace Inv39.Init
theorem scalarStore (s : State) (k : Key) (v : Nat) (use : scalar k=true) :
    ∃ edit : Edit, s.storeFieldWord (field k) v=applyEdit s edit := by
  cases k <;> first | contradiction | skip
  case «universe» => exact ⟨.scalar 6 (Or.inr (Or.inl rfl)) _,rfl⟩
  case number => exact ⟨.scalar 7 (Or.inr (Or.inr rfl)) _,rfl⟩
  case cap => exact ⟨.scalar 5 (Or.inl rfl) _,rfl⟩
theorem bytesStore (s : State) (k : Key) (bs : List Byte) (use : scalar k=false) :
    ∃ edit : Edit, s.storeStorageBytesAt (slot k) bs=applyEdit s edit := by
  cases k <;> first | contradiction | skip
  all_goals first | exact ⟨.metadata 3 (Or.inl rfl) bs,rfl⟩ | exact ⟨.metadata 4 (Or.inr rfl) bs,rfl⟩
theorem put (b : State) (c : Context) (r next : Runtime) (k : Key) (v : Value) (h : region b r)
    (lookup : c.storageField? (name k)=some (field k))
    (write : r.storeStorageField c (name k) v=.ok next) : region b next := by
  unfold Runtime.storeStorageField at write; rw [lookup] at write
  cases materialized:r.storageMaterializedValue v with
  | error err => simp [materialized,Bind.bind,Except.bind] at write
  | ok value =>
    simp only [materialized,Bind.bind,Except.bind,field,kind] at write
    cases use:scalar k with
    | false =>
      simp only [use,Bool.false_eq_true,if_false] at write
      cases value <;> first | contradiction | skip
      case bytes bs =>
        cases write
        obtain ⟨edit,eq⟩ := bytesStore r.state k bs use
        exact ⟨eq ▸ added h.1 edit,h.2⟩
    | true =>
      simp only [use,if_true] at write
      cases val:coerceStorageWordAs .uint256 value with
      | error err => simp [val,Bind.bind,Except.bind] at write
      | ok word =>
        simp only [val,Bind.bind,Except.bind] at write
        obtain ⟨edit,eq⟩ := scalarStore r.state k word use
        cases write
        refine ⟨?_,h.2⟩
        apply unchanged (added h.1 edit)
        rw [←eq]; simp only [field,kind,use,if_true]
theorem deepPut (b : State) (c : Context) (r next : Runtime) (k : Key) (v : Value) (h : region b r)
    (lookup : c.storageField? (name k)=some (field k))
    (write : (ResolvedLValue.storageField (name k)).write c r v=.ok next) : region b next := by
  change r.storeStorageFieldWithDeepClear c (name k) v=.ok next at write
  unfold Runtime.storeStorageFieldWithDeepClear at write; rw [lookup] at write
  cases materialized:r.storageMaterializedValue v with
  | error err => simp [materialized,Bind.bind,Except.bind] at write
  | ok val =>
    cases k <;> apply put b c r next _ val h lookup <;> simpa only [materialized,field,kind,scalar,if_true,
      Bool.false_eq_true,if_false,Bind.bind,Except.bind] using write
end Inv39.Init
