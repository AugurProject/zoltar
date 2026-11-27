import Inv48CloneGettersVisible
import Inv48GeneratedGetterTails
import Inv48MinimaCanonical
import Inv48MinimaInternal
import Inv48PositiveSyntax
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.RepMinimum
open Inv48.Minima Inv48.CloneGetters Inv48.SymbolicClone Inv48.CloneRead
set_option linter.unusedSimpArgs false
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
abbrev ur := "_ret_universeId_0"
def callee (r : Runtime) : Runtime := {r with locals := [[("_ret0",.word 0)]]}
def initial (r : Runtime) := (callee r).pushScope.pushScope.pushScope.declareLocal Inv03.Bodies.tmp (.word 0)
def universeAfter (r : Runtime) (code : List Nat) (u : Nat) :=
  (visible (initial r).pushScope code ur u).popScope
-- The captured return writes the enclosing hoist before its temporary scope is popped.
def universeDone (r : Runtime) (code : List Nat) (u : Nat) :=
  {post (initial r) code with locals := [[(Inv03.Bodies.tmp,.word u)],[],[],[("_ret0",.word 0)]]}
def oracleStart (r : Runtime) (code : List Nat) (u : Nat) :=
  ((universeDone r code u).declareLocal "#view47475" (.word u)).declareLocal Inv03.Bodies.tmp (.word 0)
def oracleDone (c : Context) (r : Runtime) (code : List Nat) (u root x : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :=
  let q := wordReply c (oracleStart r code u) root (Inv12.wireBytes repSelector [u]) out
  {q with locals := [[(Inv03.Bodies.tmp,.word x),("#view47475",.word u),(Inv03.Bodies.tmp,.word u)],[],[],[("_ret0",.word 0)]]}
def final (c : Context) (r : Runtime) (code : List Nat) (u root x : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :=
  (Inv32OneArg.store ((oracleDone c r code u root x out).declareLocal "#view47476" (.word x))
    Inv03.Bodies.tmp (Inv03.ceilQuot x 100)).popScope.popScope.popScope

theorem universeBlock (n : Nat) (c : Context) (r : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<R)
    (boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token) :
    Stmt.eval (n+46) Inv48.Source.model.core.table c (initial r)
      (.block [.varDecl .uint256 ur none,
        .captureReturn [ur] (.internalCall [ur] universeKey []),
        .assign (.var Inv03.Bodies.tmp) (.var ur)]) =
      pure (.normal (universeDone r (runtimeCode implementation universeBytes token) (decode universeBytes))) := by
  have call := universe_visible n c (initial r).pushScope ur implementation universeBytes token hi hu ht cu ct selfWord boundary
  have copy := Inv48.CloneGetters.assign (n+44) Inv48.Source.model.core.table c
    (visible (initial r).pushScope (runtimeCode implementation universeBytes token) ur (decode universeBytes))
    {post (initial r) (runtimeCode implementation universeBytes token) with locals := [[(ur,.word (decode universeBytes))],[(Inv03.Bodies.tmp,.word (decode universeBytes))],[],[],[("_ret0",.word 0)]]}
    Inv03.Bodies.tmp 0 (decode universeBytes) (.var ur)
    (by rfl)
    (Inv32Guards.readWord _ _ _ _ _ (visible_lookup _ _ _ _))
    (by simp [visible,initial,callee,post,Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,
      Runtime.assignLocal?,LocalEnv.assign?,Frame.assign?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Value.coerceLike?,Runtime.pushScope,Inv32CeilFlags.h0,Value.isMemoryObject,Inv03.Bodies.tmp,ur])
  rw [Stmt.eval]
  dsimp only
  rw [Stmt.evalList,decl_none]
  simp only [pb,Ty.defaultValue]
  rw [Stmt.evalList,Stmt.eval]
  dsimp only
  rw [call]
  simp only [pb]
  rw [Stmt.evalList,copy]
  simp only [pb,Stmt.evalList]
  rfl
end Inv48.RepMinimum
