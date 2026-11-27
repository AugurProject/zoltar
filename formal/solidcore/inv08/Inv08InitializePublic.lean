import Inv08InitializeExec
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Initialize

def fresh (sender : Nat) := State.empty.storeImmutable "initializer" (.word sender)
def output (c : Context) (s : State) (tm d : Nat) :=
  {FundingHistory.initializeStorage (Release.entryState c s) tm d with constructorOutput? := none}

theorem publishedInitializer : model.core.context.immutableField? "initializer" = some ⟨"initializer",.address⟩ := by
  let recognizes : Option ImmutableField → Bool := fun | some ⟨"initializer",.address⟩ => true | _ => false
  have sound (v : Option ImmutableField) (h : recognizes v) : v=some ⟨"initializer",.address⟩ := by
    dsimp [recognizes] at h; split at h <;> simp_all
  exact sound _ (by native_decide)

theorem freshRead (c : Context) (fields : c.immutableFields=model.core.context.immutableFields) :
    (Release.baseRuntime c (fresh c.sender)).loadImmutableField c "initializer" = pure (.word c.sender) := by
  have lookup : c.immutableField? "initializer"=some ⟨"initializer",.address⟩ := by
    unfold Context.immutableField?
    rw [fields]; exact publishedInitializer
  simp [Runtime.loadImmutableField,lookup,Release.baseRuntime,Release.entryState,fresh,State.storeImmutable,
    State.immutable?,ImmutableMap.lookup?,ImmutableMap.insertLoop,Ty.coerceValue?]
  rfl

theorem freshSlot (c : Context) (i : Nat) : (Release.entryState c (fresh c.sender)).loadSlot i=0 := by
  simp [Release.entryState,fresh,State.loadSlot,State.storeImmutable,State.empty,StorageMap.lookup?]

theorem generated (n : Nat) (c : Context) (tm d : Nat) (free : c.value=0)
    (fields : c.storageFields=model.core.context.storageFields) (imms : c.immutableFields=model.core.context.immutableFields)
    (fit : c.sender<R) (tf : tm<2^48) (df : d<2^48) (pos : 0<d) (current : tm≤EnvWord.blockTimestamp.eval c)
    (size : (Authority.bytes c (Release.baseRuntime c (fresh c.sender))).length=65)
    (nz : Authority.prefixWord (Authority.bytes c (Release.baseRuntime c (fresh c.sender))) 20≠0) :
    TypeCheck.CheckedContract.callTargetWithContext? (n+42) model (.name "initialize") c (fresh c.sender) [.word tm,.word d] =
      some (.returned (output c (fresh c.sender) tm d) []) := by
  let s := fresh c.sender
  let r := Release.baseRuntime c s
  let dst := {(Authority.post c r).withFrame (frame tm d) with state:=FundingHistory.initializeStorage r.state tm d}
  have X := execute n c r tm d tf df pos fields (by rw [Release.durationRead]; change wordBitRange 144 48 ((Release.entryState c (fresh c.sender)).loadSlot 0)=0; rw [freshSlot]; decide) current fit (freshRead c imms) size nz
  change Stmt.eval _ _ _ _ body.value=pure (.normal dst) at X
  rw [←fromSource] at X
  have noValue : fn.acceptsValue c.value=true := by rw [free]; simp [FunctionDef.acceptsValue,wordEq]
  have run : fn.evalBodyEntry (n+42) model.core.table c s [.word tm,.word d]=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry
    rw [noValue,initial]; exact congrArg some X
  have outputs : fn.collectReturns dst = .ok [] := by
    unfold FunctionDef.collectReturns
    rw [results]; rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [dispatch]
  change fn.call? _ _ _ _ _ = _
  unfold FunctionDef.call? FunctionDef.call
  rw [run]
  change some (fn.callBodyResult s (.normal dst)) = _
  simp only [FunctionDef.callBodyResult,outputs,List.map_nil]; rfl
end Inv08.Initialize
