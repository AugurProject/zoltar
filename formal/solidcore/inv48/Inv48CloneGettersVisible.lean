import Inv48CloneGettersResults
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false

def visible (base : Runtime) (code : List Nat) (target : String) (v : Nat) :=
  (post base code).declareLocal target (.word v)

theorem assign_declared (base : Runtime) (code : List Nat) (target : String) (v : Nat) :
    internalCallAssign (post (base.declareLocal target (.word 0)) code) [target] [.word v] =
      pure (.normal (visible base code target v)) := by
  cases h : base.locals <;>
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
      Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.lookupMemoryRef?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,visible,Runtime.declareLocal,LocalEnv.declare,
      post,Runtime.allocMemory,h]

theorem visible_lookup (base : Runtime) (code : List Nat) (target : String) (v : Nat) :
    (visible base code target v).lookupLocal? target = some (.word v) := by
  cases h : base.locals <;>
    simp [visible,post,Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,h]

theorem visible_post (base : Runtime) (code : List Nat) (target : String) (v : Nat) :
    (visible base code target v).state = base.state ∧
    (visible base code target v).scratch = base.scratch ∧
    (visible base code target v).nextMemoryByte = base.nextMemoryByte + (Value.bytes code).memoryAllocationBytes ∧
    (visible base code target v).nextMemory = base.nextMemory+1 ∧
    (visible base code target v).loadMemory? base.nextMemory = some (.bytes code) ∧
    (visible base code target v).locals = (base.declareLocal target (.word v)).locals := by
  simp [visible,post,Runtime.allocMemory,Runtime.declareLocal,Runtime.loadMemory?,
    MemoryMap.lookup?,MemoryMap.insertLoop]

theorem universe_visible (n : Nat) (c : Context) (base : Runtime) (target : String)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+44) Inv48.Source.model.core.table c (base.declareLocal target (.word 0))
      (.internalCall [target] universeKey []) =
      pure (.normal (visible base (runtimeCode implementation universeBytes token) target (decode universeBytes))) := by
  rw [universe_call n c (base.declareLocal target (.word 0)) [target] implementation universeBytes token hi hu ht cu ct selfWord boundary]
  exact assign_declared base _ target _

theorem reputation_visible (n : Nat) (c : Context) (base : Runtime) (target : String)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+43) Inv48.Source.model.core.table c (base.declareLocal target (.word 0))
      (.internalCall [target] reputationKey []) =
      pure (.normal (visible base (runtimeCode implementation universeBytes token) target (decode token))) := by
  rw [reputation_call n c (base.declareLocal target (.word 0)) [target] implementation universeBytes token hi hu ht cu ct selfWord boundary]
  exact assign_declared base _ target _

theorem universe_oracle (c : Context) (base : Runtime) (target : String) (code universeBytes : List Nat)
    (selector : Nat) (hu : universeBytes.length = 31) (cu : ∀ b ∈ universeBytes, b < 256)
    (sel : selector < Inv32Division.R) :
    (Inv48.Minima.oracleData selector target).evalWithRuntimeByContext c
      (visible base code target (decode universeBytes)) =
      .ok (.bytes (Inv12.wireBytes selector [decode universeBytes]),visible base code target (decode universeBytes)) :=
  oracle_argument c _ selector target universeBytes hu cu sel (visible_lookup base code target _)

/-- The concrete callee frame and body response expected by escrow lookup consumers.
There is no premise that the wrapper already succeeded. -/
theorem reputation_frame (n : Nat) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    internalCallEnter? reputationFn [] base = some (tStart base,base.locals) ∧
    Stmt.eval (n+42) Inv48.Source.model.core.table {c with checked := true} (tStart base) reputationFn.body =
      pure (.returned (tStart (post base (runtimeCode implementation universeBytes token))) [.word (decode token)]) ∧
    coerceReturnBindingsRef reputationFn.returns
      (tStart (post base (runtimeCode implementation universeBytes token))) [.word (decode token)] =
      .ok [.word (decode token)] := by
  refine ⟨?_,reputation_body n _ {c with checked := true} base library_lookup implementation universeBytes token hi hu ht cu ct selfWord boundary,?_⟩
  · simp [internalCallEnter?,InternalFunction.initialFrame?,reputationFn,reputationFnPattern,fnPattern,Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,binding,addrPattern,Inv32Shapes.Ty_uint256,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,tStart]
  · simp [reputationFn,reputationFnPattern,fnPattern,Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,binding,addrPattern,Inv32Shapes.Ty_uint256,coerceReturnBindingsRef,
      coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      tStart,post,Runtime.allocMemory,Ty.coerceValue?,Bind.bind,Except.bind]

theorem canonical_memory_bytes (base : Runtime) (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20) :
    (post base (runtimeCode implementation universeBytes token)).nextMemoryByte = base.nextMemoryByte+128 := by
  have len := canonical_length implementation universeBytes token hi hu ht
  simp [post,Runtime.allocMemory,Value.memoryAllocationBytes,memoryRoundUpWord,len,wordBytes]

end Inv48.CloneGetters
