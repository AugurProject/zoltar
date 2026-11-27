import Inv48CloneGettersBody
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def post (base : Runtime) (code : List Nat) : Runtime := (base.allocMemory (.bytes code)).1

theorem library_body (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+38) table c (callee base 0 0) libraryBody =
      pure (.normal (callee (post base (runtimeCode implementation universeBytes token))
        (decode universeBytes) (decode token))) := by
  let code := runtimeCode implementation universeBytes token
  let final := refState (callee base (decode universeBytes) (decode token)).pushScope code 51 (decode token)
  have dec : Stmt.eval (n+36) table c (offset (callee base 0 0).pushScope)
      (.block (decoderPrefix ++ [firstLoop,saveUniverse,reset,secondLoop,saveToken])) =
      pure (.normal final.popScope) := by
    apply Inv32Hoist.block
    exact decoder_eval n table c base implementation universeBytes token hi hu ht cu ct selfWord boundary
  have inner : Stmt.eval (n+37) table c (callee base 0 0).pushScope
      (.block (prologue ++ [.block (decoderPrefix ++ [firstLoop,saveUniverse,reset,secondLoop,saveToken])])) =
      pure (.normal final.popScope.popScope) := by
    apply Inv32Hoist.block
    rw [seq_append _ _ _ _ _ _ _ (prologue_eval (n+33) table c (callee base 0 0).pushScope code
      selfWord boundary (canonical_length _ _ _ hi hu ht))]
    rw [Stmt.evalList,dec]
    simp only [pb,Stmt.evalList]
  rw [body_shape]
  have body : Stmt.eval (n+38) table c (callee base 0 0)
      (.block [.skip,.skip,.block (prologue ++ [.block (decoderPrefix ++ [firstLoop,saveUniverse,reset,secondLoop,saveToken])])]) =
      pure (.normal final.popScope.popScope.popScope) := by
    apply Inv32Hoist.block
    rw [Stmt.evalList,Stmt.eval]
    dsimp only
    simp only [pb]
    rw [Stmt.evalList,Stmt.eval]
    dsimp only
    simp only [pb]
    rw [Stmt.evalList,inner]
    simp only [pb,Stmt.evalList]
  rw [body]
  rfl

@[simp] theorem post_state (base : Runtime) (code : List Nat) : (post base code).state = base.state := rfl
@[simp] theorem post_locals (base : Runtime) (code : List Nat) : (post base code).locals = base.locals := rfl
@[simp] theorem post_nextMemory (base : Runtime) (code : List Nat) :
    (post base code).nextMemory = base.nextMemory+1 := rfl
@[simp] theorem post_memory (base : Runtime) (code : List Nat) :
    (post base code).loadMemory? base.nextMemory = some (.bytes code) := by
  simp [post,Runtime.allocMemory,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop]

end Inv48.CloneGetters
