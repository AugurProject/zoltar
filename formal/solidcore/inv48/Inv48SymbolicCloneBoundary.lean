import Inv48SymbolicCloneRefCanonical
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
open Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

def selfCode : Expr := .envBytesLookup .accountCode .self

/-- The external boundary is the interpreter's authoritative code read, not merely
`Context.accountCodes`: after world adoption `State.envWorld?` is authoritative.
No CREATE, delegatecall provenance, prefix authentication, live-chain immutability,
or truth of an RPC response is asserted. The canonical-code equality is an input. -/
theorem self_code_read (n : Nat) (c : Context) (base : Runtime) (code : List Nat)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = code) :
    Expr.evalFuel (n+2) c base selfCode = pure (.bytes code,base) := by
  unfold selfCode
  rw [Expr.evalFuel, Expr.evalFuel]
  simp only [pb]
  change (do
    let key ← liftM (Value.word c.self).expectWord
    pure (Value.bytes (base.state.envAccountCode c key),base) : SolI (Value × Runtime)) = _
  have key : (Value.word c.self).expectWord = .ok c.self := by
    change Except.ok (c.self % R) = _
    rw [Nat.mod_eq_of_lt selfWord]
  rw [key]
  change (pure (Value.bytes (base.state.envAccountCode c c.self),base) : SolI (Value × Runtime)) = _
  rw [boundary]

/-- Execution of the actual generated external-code cache declaration, for any base runtime. -/
theorem cache_self_code (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = code) :
    Stmt.eval (n+1) table c base (.memoryVarDecl .bytesCalldata "#extcode" (some selfCode)) =
      pure (.normal ((base.allocMemory (.bytes code)).1.declareLocal "#extcode"
        (.memoryRef base.nextMemory))) := by
  have read := self_code_read 1 c base code selfWord boundary
  have value : Expr.memoryRefOrValue c base selfCode = pure (none,some (.bytes code),base) := by
    unfold Expr.memoryRefOrValue
    rw [Expr.memoryRefOrValueFuel]
    change (do
      let (v,r) ← Expr.evalFuel 3 c base selfCode
      pure (none,some v,r)) = _
    rw [read]
    rfl
    all_goals simp [selfCode]
  rw [Stmt.eval]
  dsimp only
  rw [value]
  change (match base.declareMemoryLocal .bytesCalldata "#extcode" (.bytes code) with
    | some updated => (pure (.normal updated) : SolI Result)
    | none => pure (.reverted base .typeMismatch)) = _
  rfl

/-- The external read and complete actual first loop for every canonical self code.
This exposes the exact remaining composition boundary: `refState` is the prepared
cached-code frame. This result does not claim execution of the surrounding library
prefix, return assignments, internal-call frame machinery, or universeId wrapper. -/
theorem self_first_loop (n : Nat) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Expr.eval c base selfCode = pure (.bytes (runtimeCode implementation universeBytes token),base) ∧
    Stmt.eval (n+35) Inv48.Source.model.core.table c
      (refState base (runtimeCode implementation universeBytes token) 0 0) firstLoop =
      pure (.normal (refState base (runtimeCode implementation universeBytes token) 31
        (decode universeBytes))) := by
  constructor
  · exact self_code_read 1 c base _ selfWord boundary
  · exact first_loop_ref n _ c base implementation universeBytes token hi hu ht cu

end Inv48.SymbolicClone
