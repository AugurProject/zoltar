import Inv39MarkerSuffixSyntax
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker.ActualSuffix
set_option maxHeartbeats 4000000
set_option linter.unusedSimpArgs false
theorem caughtValue {α : Type} (x : α) : (pure x : SolI α).caught=pure (.ok x) := rfl
 theorem packedRead (c : Context) (r : Runtime) (bs digits : List Nat) (id : Nat)
    (read : r.lookupLocal? "number"=some (.memoryRef id))
    (mem : r.loadMemory? id=some (.bytes digits)) :
    (packed bs).eval c r=pure (.bytes ((bs.map normByte ++ digits).map normByte),r) := by
  have var : Expr.evalFuel 4 c r (.var "number")=pure (.bytes digits,r) := by
    simp [Inv08.Authority.bindPure,Inv08.Authority.liftPure,Expr.evalFuel,Runtime.lookupStorageBase?,read,Runtime.derefMemoryValue,mem]
  have args : Expr.evalListFuel 6 c r [.byteArray bs,.var "number"]=
      pure ([.bytes (bs.map normByte),.bytes digits],r) := by
    rw [Expr.evalListFuel]
    have lit : Expr.evalFuel 5 c r (.byteArray bs)=pure (.bytes (bs.map normByte),r) := rfl
    rw [lit]
    simp only [Inv08.Authority.bindPure]
    rw [Expr.evalListFuel,var]
    simp only [Inv08.Authority.bindPure,Expr.evalListFuel]
  change Expr.evalFuel 7 c r (.encode .packed none [0,0] [.bytesCalldata,.bytesCalldata] [.byteArray bs,.var "number"])=_
  rw [Expr.evalFuel]
  dsimp only
  rw [args]
  simp only [Inv08.Authority.bindPure]
  have mat : r.materializeForValueUseList c [.bytes (bs.map normByte),.bytes digits]=
      .ok [.bytes (bs.map normByte),.bytes digits] := by
    simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  rw [mat]
  simp only [Inv08.Authority.liftPure,Inv08.Authority.bindPure]
  simp [abiEncodePackedValues?,abiEncodePackedValue?,Bind.bind,Option.bind,List.map_append,List.map_map]

theorem numberRun (n : Nat) (c : Context) (r : Runtime) (id : Nat)
    (read : r.lookupLocal? hoist=some (.memoryRef id)) :
    Stmt.eval (n+1) model.core.table c r (.memoryVarDecl .bytesCalldata "number" (some (.var hoist)))=
      pure (.normal (r.declareLocal "number" (.memoryRef id))) := by
  rw [Stmt.eval]
  simp [caughtValue,Inv08.Authority.bindPure,Expr.memoryRefOrValue,Expr.memoryRefOrValueFuel,Runtime.lookupMemoryRef?,read]

theorem normalizeStore (s : State) (slot : Nat) (bs : List Nat) :
    s.storeStorageBytesAt slot (bs.map normByte)=s.storeStorageBytesAt slot bs := by
  have idem : (bs.map normByte).map normByte=bs.map normByte := by
    simp only [List.map_map]
    apply List.map_congr_left
    intro b hb
    change (b%256)%256=b%256
    exact Nat.mod_mod b 256
  unfold State.storeStorageBytesAt
  rw [idem]

theorem bytesWrite (c : Context) (r : Runtime) (k : Key) (bs : List Nat)
    (use : k=.name ∨ k=.symbol)
    (fields : c.storageFields=model.core.context.storageFields) :
    (ResolvedLValue.storageField (name k)).write c r (.bytes bs)=
      .ok {r with state:=r.state.storeStorageBytesAt (slot k) bs} := by
  have lookup : c.storageField? (name k)=some (field k) := by
    change c.storageFields.find? _ = _;rw [fields];exact layout k
  rcases use with rfl|rfl <;>
    simp [ResolvedLValue.write,Runtime.storeStorageFieldWithDeepClear,Runtime.storeStorageField,
      lookup,Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      field,kind,scalar,slot,Bind.bind,Except.bind]

theorem metadataRun (n : Nat) (c : Context) (r : Runtime) (bs digits : List Nat) (id : Nat) (k : Key)
    (use : k=.name ∨ k=.symbol)
    (read : r.lookupLocal? "number"=some (.memoryRef id))
    (mem : r.loadMemory? id=some (.bytes digits))
    (fields : c.storageFields=model.core.context.storageFields)
    (normal : bs.map normByte=bs) :
    Stmt.eval (n+1) model.core.table c r (.assign (.storage (name k)) (packed bs))=
      pure (.normal {r with state:=r.state.storeStorageBytesAt (slot k) (bs++digits)}) := by
  rw [Stmt.eval];dsimp only
  try simp only [LValue.wantsMemoryRefRhs]
  rw [packedRead c r bs digits id read mem]
  have resolve : (LValue.storage (name k)).resolveWithRuntime c r=pure (.storageField (name k),r) := rfl
  simp only [Bool.false_eq_true,if_false,caughtValue,Inv08.Authority.bindPure]
  rw [resolve]
  simp only [caughtValue,Inv08.Authority.bindPure]
  change (match (ResolvedLValue.storageField (name k)).write c r (.bytes ((bs.map normByte++digits).map normByte)) with
    | .ok next => (pure (Result.normal next) : SolI Result)
    | .error err => pure (Result.reverted r err))=_
  rw [bytesWrite c r k _ use fields,normal,normalizeStore]

theorem capWrite (c : Context) (r : Runtime) (v : Nat)
    (fields : c.storageFields=model.core.context.storageFields) :
    (ResolvedLValue.storageField "totalTheoreticalSupplyAttoRep").write c r (.word v)=
      .ok {r with state:=r.state.storeSlot 5 (Shared.norm v)} := by
  have lookup : c.storageField? "totalTheoreticalSupplyAttoRep"=some (field .cap) := by
    change c.storageFields.find? _ = _;rw [fields];exact layout .cap
  simp [ResolvedLValue.write,Runtime.storeStorageFieldWithDeepClear,Runtime.storeStorageField,lookup,
    Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
    coerceStorageWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,field,kind,scalar,slot,
    wordBytes,State.storeFieldWord,State.storeFieldSlot,StorageField.isPacked,Bind.bind,Except.bind]

theorem cap (base : State) (c : Context) (fields : c.storageFields=model.core.context.storageFields) :
    Frame.StmtPreserves (fun r => Suffix base r.state) model.core.table c
      (.assign (.storage "totalTheoreticalSupplyAttoRep") (.castOp .uintCleanup 256 (.var "totalTheoreticalSupplyAttoRep_"))) := by
  apply Frame.castSet _ _ _ _ _ _ _ Frame.isWord (fun _ loc=>loc=.storageField "totalTheoreticalSupplyAttoRep")
    (Frame.cleaned (Frame.localRead _) _)
  · intro r hr
    exact Frame.pureValue _ ⟨rfl,rfl⟩
  · rintro r loc value next prior ⟨w,rfl⟩ rfl write
    rw [capWrite c r w fields] at write
    cases write
    exact Suffix.cap _ prior

theorem event (base : State) (t : FunctionTable) (c : Context) (name : String) (es : List Source.Expr)
    (valid : ∀ e∈es, Frame.ReadOnly e) :
    Frame.StmtPreserves (fun r => Suffix base r.state) t c (.emitEvent name es) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    have sched (ids : List Nat) : ∀ x∈ids.filterMap (fun i=>es[i]?), Frame.ReadOnly x := by
      intro x hx
      obtain ⟨i,_,get⟩ := List.mem_filterMap.mp hx
      exact valid x (List.mem_of_getElem? get)
    apply Frame.bind (Frame.caught (Frame.inputs _ (sched _) _ c r))
    rintro (err|⟨vs,mid⟩) eq
    · exact Frame.pureValue (P:=fun res : Result => Suffix base res.runtime.state) _ hr
    · change mid=r at eq; subst mid; dsimp only
      split <;> first | exact Frame.pureValue (P:=fun res : Result => Suffix base res.runtime.state) _ hr | skip
      split
      · rename_i out ok
        exact Frame.pureValue (P:=fun res : Result => Suffix base res.runtime.state) (.normal out) (Suffix.event c name _ hr ok)
      · exact Frame.pureValue (P:=fun res : Result => Suffix base res.runtime.state) _ hr
end Inv39.Init.Marker.ActualSuffix
