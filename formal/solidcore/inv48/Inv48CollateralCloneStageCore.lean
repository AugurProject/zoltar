import Inv48CollateralReadDecodedTrace
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneStage
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem seqPure (n : Nat) (c : Context) (r s : Runtime)
    (a : Stmt) (rest : List Stmt) (out : Result)
    (first : Stmt.eval n table c r a = pure (.normal s))
    (last : Stmt.evalList n table c s rest = pure out) :
    Stmt.evalList n table c r (a::rest) = pure out := by
  rw [Stmt.evalList,first,pb]
  exact last

theorem hoistPure (n : Nat) (c : Context) (r s next : Runtime)
    (target key : String) (v : Nat)
    (call : Stmt.eval (n+1) table c (hoistInside r target 0)
      (.internalCall [target] key []) = pure (.normal s))
    (old : s.lookupLocal? tmp = some (.word 0))
    (read : s.lookupLocal? target = some (.word v))
    (put : s.assignLocal? tmp (.word v) = some next) :
    Stmt.eval (n+3) table c r (hoist target key) = pure (.normal next.popScope) := by
  have copy := Inv48.CloneGetters.assign (n+1) table c s next tmp 0 v (.var target) old
    (Inv32Guards.readWord _ _ _ _ _ read) put
  have capture : Stmt.eval (n+2) table c (hoistInside r target 0)
      (.captureReturn [target] (.internalCall [target] key [])) = pure (.normal s) := by
    rw [Stmt.eval]
    change (Stmt.eval (n+1) table c (hoistInside r target 0) (.internalCall [target] key []) >>= _) = _
    rw [call,pb]
  have body : Stmt.evalList (n+2) table c r.pushScope
      [.varDecl .uint256 target none,.captureReturn [target] (.internalCall [target] key []),
       .assign (.var tmp) (.var target)] = pure (.normal next) := by
    apply seqPure _ _ _ _ _ _ _ (decl_none (n+1) table c r.pushScope .uint256 target)
    simp only [Ty.defaultValue]
    change Stmt.evalList (n+2) table c (hoistInside r target 0) _ = _
    apply seqPure _ _ _ _ _ _ _ capture
    apply seqPure _ _ _ _ _ _ _ copy
    rw [Stmt.evalList]
  unfold hoist
  rw [Stmt.eval]
  change (Stmt.evalList (n+2) table c r.pushScope _ >>= _) = _
  rw [body,pb]; rfl

theorem universePure (n : Nat) (c : Context) (r : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv48.SymbolicClone.R)
    (boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token) :
    Stmt.eval (n+46) table c (r.declareLocal tmp (.word 0))
      (hoist universeRet universeKey) =
      pure (.normal (universeStage r (runtimeCode implementation universeBytes token) (decode universeBytes))) := by
  let code := runtimeCode implementation universeBytes token
  let r0 := r.declareLocal tmp (.word 0)
  let s := visible r0.pushScope code universeRet (decode universeBytes)
  let next := (universeStage r code (decode universeBytes)).pushScope.declareLocal universeRet (.word (decode universeBytes))
  have call := universe_visible n c r0.pushScope universeRet implementation universeBytes token hi hu ht cu ct selfWord boundary
  have run := hoistPure (n+43) c r0 s next universeRet universeKey (decode universeBytes)
    call
    (by cases h : r.locals <;> simp [s,r0,visible,post,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,tmp,universeRet,h,tmp,Inv32CeilFlags.h0,Inv03.Bodies.tmp,universeView,universeRet,universeStage,post,Runtime.allocMemory])
    (visible_lookup _ _ _ _)
    (by cases h : r.locals <;> simp [s,r0,next,visible,universeStage,post,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,tmp,universeRet,h,tmp,Inv32CeilFlags.h0,Inv03.Bodies.tmp,universeView,universeRet,universeStage,post,Runtime.allocMemory])
  exact run


end Inv48.CollateralCloneStage
