import Inv39AllowanceLayout
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
def slot (owner spender : Nat) := mappingStorageSlot (mappingStorageSlot 1 (Shared.norm owner)) (Shared.norm spender)
theorem key (base a : Nat) : mappingStorageSlotForKey base .address (.word a) = .ok (mappingStorageSlot base (Shared.norm a)) := by
  simp [mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,Bind.bind,Except.bind]
theorem anchor (c : Context) (r : Runtime) (o sp : Value) (fields : c.storageFields=model.core.context.storageFields) :
    r.storageBaseAnchor c (.field "_allowances") [o,sp]=.ok (1,layout) := by
  have field : c.storageField? "_allowances"=some descriptor := by change c.storageFields.find? _ = _; rw [fields]; exact bound
  simp only [Runtime.storageBaseAnchor,field,Bind.bind,Except.bind]; rfl
theorem step (s : State) (base next : Nat) (l : StorageLayout) (k : Source.Value) (ks : List Source.Value)
    (hash : mappingStorageSlotForKey base .address k=.ok next) :
    s.resolveStoragePathSlot base (.mapping .address l) (k::ks)=s.resolveStoragePathSlot next l ks := by
  rw [State.resolveStoragePathSlot,hash]; rfl
theorem doneSlot (s : State) (base : Nat) (l : StorageLayout) : s.resolveStoragePathSlot base l []=.ok (base,l) := by rw [State.resolveStoragePathSlot]
theorem two (s : State) (base next final : Nat) (o sp : Source.Value) (h : mappingStorageSlotForKey base .address o=.ok next)
    (h' : mappingStorageSlotForKey next .address sp=.ok final) :
    s.resolveStoragePathSlot base layout [o,sp]=.ok (final,.scalar .uint256) := by
  unfold layout
  rw [step s base next (.mapping .address (.scalar .uint256)) o [sp] h,step s next final (.scalar .uint256) sp [] h',doneSlot]
theorem mapped (s : State) (base : Nat) (o sp : Nat) :
    s.resolveStoragePathSlot base layout [.word o,.word sp] =
      .ok (mappingStorageSlot (mappingStorageSlot base (Shared.norm o)) (Shared.norm sp),.scalar .uint256) :=
  two s base (mappingStorageSlot base (Shared.norm o)) (mappingStorageSlot (mappingStorageSlot base (Shared.norm o)) (Shared.norm sp))
    (.word o) (.word sp) (key base o) (key (mappingStorageSlot base (Shared.norm o)) sp)
theorem resolveFrom (c : Context) (r : Runtime) (base : StorageBase) (xs : List Source.Value) (initial final : Nat) (l out : StorageLayout)
    (start : r.storageBaseAnchor c base xs=.ok (initial,l)) (rest : r.state.resolveStoragePathSlot initial l xs=.ok (final,out)) :
    r.resolveStorageBasePath c base xs=.ok (final,out) := by
  unfold Runtime.resolveStorageBasePath; rw [start]; exact rest
theorem path (c : Context) (r : Runtime) (owner spender : Nat) (fields : c.storageFields=model.core.context.storageFields) :
    r.resolveStorageBasePath c (.field "_allowances") [.word owner,.word spender]=.ok (slot owner spender,.scalar .uint256) :=
  resolveFrom c r (.field "_allowances") [.word owner,.word spender] 1 (slot owner spender) layout (.scalar .uint256)
    (anchor c r (.word owner) (.word spender) fields) (mapped r.state 1 owner spender)
theorem read (c : Context) (r : Runtime) (owner spender : Nat) (fields : c.storageFields=model.core.context.storageFields) :
    r.loadStorageBasePath c (.field "_allowances") [.word owner,.word spender]=.ok (.word (r.state.loadSlot (slot owner spender))) := by
  simp [Runtime.loadStorageBasePath,path _ _ _ _ fields,State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,loadStorageWordAs,
    Ty.storageValueFromWord?,Bind.bind,Except.bind]
theorem write (c : Context) (r : Runtime) (o s v : Nat) (fields : c.storageFields=model.core.context.storageFields) :
    (ResolvedLValue.storagePath "_allowances" [.word o,.word s]).write c r (.word v) =
      .ok {r with state:=r.state.storeSlot (slot o s) (Shared.norm v)} := by
  have mat : r.storageMaterializedValue (.word v)=.ok (.word v) := by simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  simp only [ResolvedLValue.write,Runtime.storeStoragePathWithDeepClear,Runtime.storeStorageBasePathWithDeepClear,mat,
    path _ _ _ _ fields,Bind.bind,Except.bind]; rfl
end Inv39.Allowance
