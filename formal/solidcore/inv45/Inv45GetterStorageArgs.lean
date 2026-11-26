import Inv45GetterDispatch
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv45.Public
set_option maxRecDepth 4096
set_option maxHeartbeats 4000000

def questionSlot (q : Nat) := mappingStorageSlot 2 (Shared.norm q)
def questionMemberSlot (q offset : Nat) := normWord (Shared.norm (questionSlot q) + offset)

theorem memberResolution (c : Context) (r : Runtime) (q : Nat)
    (fields : c.storageFields=model.core.storageFields) :
    r.resolveStorageBasePath c (.field "questions") [.word q,.word 4]=
      .ok (questionMemberSlot q 2,.packedScalar 12 15 false .uint256) ∧
    r.resolveStorageBasePath c (.field "questions") [.word q,.word 5]=
      .ok (questionMemberSlot q 3,.packedScalar 0 32 true .int256) ∧
    r.resolveStorageBasePath c (.field "questions") [.word q,.word 6]=
      .ok (questionMemberSlot q 4,.packedScalar 0 32 true .int256) ∧
    r.resolveStorageBasePath c (.field "questions") [.word q,.word 7]=
      .ok (questionMemberSlot q 5,.string) := by
  have anchor (i : Nat) : r.storageBaseAnchor c (.field "questions") [.word q,.word i]=
      .ok (2,.mapping .uint256 questionLayout) := by
    simp [Runtime.storageBaseAnchor,(registered c fields).2,questionField,Bind.bind,Except.bind,Pure.pure,Except.pure]
  simp only [Runtime.resolveStorageBasePath,anchor,Bind.bind,Except.bind]
  norm_num [State.resolveStoragePathSlot,mappingStorageSlotForKey,Value.expectWord,questionLayout,
    structFieldStorageSlot?,StorageLayouts.fieldOffsetAndLayout?,StorageLayout.cursorStep,
    questionMemberSlot,questionSlot,Shared.norm,Shared.wordModulus,EvmYul.UInt256.size,wordModulus,wordBytes,Bind.bind,Except.bind,
    coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,
    StorageLayouts.fieldOffsetAndLayoutFrom?,StorageLayoutCursor.align]


theorem storageArguments (c : Context) (r : Runtime) (q : Nat)
    (fields : c.storageFields=model.core.storageFields) :
    r.loadStorageBasePath c (.field "questions") [.word q,.word 4]=
      r.state.loadStorageLayoutAt (questionMemberSlot q 2) (.packedScalar 12 15 false .uint256) ∧
    r.loadStorageBasePath c (.field "questions") [.word q,.word 5]=
      r.state.loadStorageLayoutAt (questionMemberSlot q 3) (.packedScalar 0 32 true .int256) ∧
    r.loadStorageBasePath c (.field "questions") [.word q,.word 6]=
      r.state.loadStorageLayoutAt (questionMemberSlot q 4) (.packedScalar 0 32 true .int256) ∧
    r.loadStorageBasePath c (.field "questions") [.word q,.word 7]=
      (do let bs ← r.state.loadStorageBytesAt (questionMemberSlot q 5); pure (.bytes bs)) := by
  obtain ⟨a,b,d,e⟩ := memberResolution c r q fields
  simp only [Runtime.loadStorageBasePath,a,b,d,e,Bind.bind,Except.bind]
  simp [State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,StorageLayout.depth,Bind.bind,Except.bind,Pure.pure,Except.pure]
def getterMember (i : Nat) : Source.Expr := .index (.storageRead .element "questions" [.var "questionId"]) (.word i)

theorem memberEval (c : Context) (r : Runtime) (q i : Nat) (v : Value) (I : i<Inv32Division.R)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (load : r.loadStorageBasePath c (.field "questions") [.word q,.word i]=.ok v) :
    Expr.eval c r (getterMember i)=pure (v,r) := by
  unfold Expr.eval getterMember
  simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd]
  rw [Expr.evalFuel]
  simp only [Expr.hasStorageRoot,if_true]
  rw [Expr.resolveLValueFuel,Inv32Guards.readWord _ _ _ _ _ look]
  simp only [Inv08.Authority.bindPure,ResolvedLValue.asStoragePath?,Expr.evalFuel]
  have norm : normWord i=i := Nat.mod_eq_of_lt I
  rw [norm]
  change (do let value ← liftM (r.loadStorageBasePath c (.field "questions") [.word q,.word i]);pure (value,r) : SolI (Value × Runtime))=_
  rw [load];rfl
  all_goals intros;rename_i impossible;cases impossible

 theorem readback (c : Context) (r : Runtime) (q n : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields)
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit) :
    r.loadStorageBasePath c (.field "questions") [.word q,.word 4]=.ok (.word n) ∧
    r.loadStorageBasePath c (.field "questions") [.word q,.word 5]=.ok (.int (Signed.word lo)) ∧
    r.loadStorageBasePath c (.field "questions") [.word q,.word 6]=.ok (.int (Signed.word hi)) ∧
    r.loadStorageBasePath c (.field "questions") [.word q,.word 7]=.ok (.bytes unit) := by
  obtain ⟨a,b,d,e⟩ := storageArguments c r q fields
  rw [a,b,d,e]
  simp [State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,StorageLayout.depth,
    packedStorageValueFromWord?,Ty.storageValueFromWord?,wordBytes,ticks,low,high,bytes,Bind.bind,Except.bind,Pure.pure,Except.pure]
def unitArgument : Source.Expr := .storageRead .load "questions" [.var "questionId",.word 7]

theorem unitEval (c : Context) (r : Runtime) (q : Nat) (unit : List Nat)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (load : r.loadStorageBasePath c (.field "questions") [.word q,.word 7]=.ok (.bytes unit)) :
    Expr.eval c r unitArgument=pure (.bytes unit,r) := by
  change Expr.evalFuel 5 c r (.storageRead .load "questions" [.var "questionId",.word 7])=_
  rw [Expr.evalFuel,Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ look]
  simp only [Inv08.Authority.bindPure,Expr.evalListFuel,Expr.evalFuel]
  change (do let value ← liftM (r.loadStorageBasePath c (.field "questions") [.word q,.word 7]);pure (value,r) : SolI (Value × Runtime))=_
  rw [load];rfl
  all_goals intros;rename_i impossible;cases impossible

theorem uintMemberEval (c : Context) (r : Runtime) (q i : Nat) (v out : Value)
    (bits : Nat) (I : i<Inv32Division.R)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (load : r.loadStorageBasePath c (.field "questions") [.word q,.word i]=.ok v)
    (clean : uintCleanup? c.checked bits v=.ok out) :
    Expr.eval c r (.castOp .uintCleanup bits (getterMember i))=pure (out,r) := by
  have ev := memberEval c r q i v I look load
  change Expr.evalFuel 8 c r (.castOp .uintCleanup bits (getterMember i))=_
  rw [Expr.evalFuel]
  change (do let (value,next) ← Expr.eval c r (getterMember i);let value ← liftM (uintCleanup? c.checked bits value);pure (value,next))=_
  rw [ev];simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,clean]
#print axioms uintMemberEval
theorem intMemberEval (c : Context) (r : Runtime) (q i : Nat) (v out : Value)
    (bits : Nat) (I : i<Inv32Division.R)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (load : r.loadStorageBasePath c (.field "questions") [.word q,.word i]=.ok v)
    (clean : intCleanup? c.checked bits v=.ok out) :
    Expr.eval c r (.castOp .intCleanup bits (getterMember i))=pure (out,r) := by
  have ev := memberEval c r q i v I look load
  change Expr.evalFuel 8 c r (.castOp .intCleanup bits (getterMember i))=_
  rw [Expr.evalFuel]
  change (do let (value,next) ← Expr.eval c r (getterMember i);let value ← liftM (intCleanup? c.checked bits value);pure (value,next))=_
  rw [ev];simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,clean]
#print axioms intMemberEval
#print axioms unitEval
#print axioms storageArguments
#print axioms memberEval
#print axioms readback
end Inv45.Public
