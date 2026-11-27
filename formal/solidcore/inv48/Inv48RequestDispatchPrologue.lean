import Inv48RequestDispatchFlow
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestPrologue
namespace Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

private theorem blockOfOuter (stmt : Stmt) (nonempty : outer stmt ≠ []) :
    stmt = .block (outer stmt) := by
  cases stmt <;> simp_all [outer]

/-- Recover the block and its complete tail from the registered source
certificate. No guessed runtime or body-shape premise is accepted. -/
theorem publicDecomposition (fn : FunctionDef)
    (registered : publicRequest = some fn) :
    fn.body = .block (publicPrologueP.value ++ (outer fn.body).drop 4) := by
  obtain ⟨actual,found,_,_,_,prologue⟩ := publicRegistered
  have eq : actual = fn := Option.some.inj (found.symm.trans registered)
  subst actual
  have nonempty : outer fn.body ≠ [] := by
    intro empty
    rw [empty] at prologue
    change [] = [_,_,_,_] at prologue
    cases prologue
  have shape := blockOfOuter fn.body nonempty
  have split := List.take_append_drop 4 (outer fn.body)
  rw [prologue] at split
  rw [split]
  exact shape

/-- The actual registered cleanup prefix reduces without effects. Every
execution (successful or reverting later) therefore reaches the true remaining
public body; no bounded-search availability is assumed. -/
theorem cleanupTree (n : Nat) (c : Context) (state : State) (p a bounty : Nat)
    (fn : FunctionDef) (registered : publicRequest = some fn)
    (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256) :
    Stmt.eval (n+2) Inv48.Source.model.core.table c (publicBase c state p a bounty) fn.body =
      (Stmt.evalList (n+1) Inv48.Source.model.core.table c
        (publicBase c state p a bounty).pushScope ((outer fn.body).drop 4) >>= pop) := by
  rw [publicDecomposition fn registered,Stmt.eval]
  change (Stmt.evalList (n+1) _ c (publicBase c state p a bounty).pushScope
    (publicPrologueP.value ++ (outer fn.body).drop 4) >>= pop) = _
  rw [Inv48.WholeQuote.listAppend,assoc,publicPrologueExecution n c state p a bounty hp ha hb]
  rfl

theorem cleanupExecution (n : Nat) (c : Context) (state : State) (p a bounty : Nat)
    (fn : FunctionDef) (registered : publicRequest = some fn)
    (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256)
    (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes
      (Stmt.eval (n+2) Inv48.Source.model.core.table c (publicBase c state p a bounty) fn.body)
      trace (.ok out)) :
    Interaction.Executes (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      (publicBase c state p a bounty).pushScope ((outer fn.body).drop 4) >>= pop) trace (.ok out) := by
  rwa [cleanupTree n c state p a bounty fn registered hp ha hb] at run
end Inv48.RequestDispatch

namespace Inv48.RequestDispatch
/-- Raw canonical dispatch to the residual public prologue, preserving the
same arbitrary transcript and final ABI encoding equation. -/
theorem publicAfterCleanup (n : Nat) (base : Context) (state : State)
    (self sender value : Nat) (data : List Byte) (p a bounty : Nat)
    (fn : FunctionDef) (registered : Inv48.RequestPrologue.publicRequest = some fn)
    (canonical : Canonical fn data p a bounty)
    (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+2) Inv48.Source.model.core base state
      self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data
    ∃ r, Interaction.Executes (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty).pushScope
      ((Inv48.RequestPrologue.outer fn.body).drop 4) >>= Inv48.RequestGuards.pop) trace (.ok r) ∧
      finish Inv48.Source.model.core fn state r = .ok out := by
  obtain ⟨r,exec,done⟩ := publicBody (n+2) base state self sender value data p a bounty fn
    registered canonical raw trace out linked run
  exact ⟨r,cleanupExecution n _ state p a bounty fn registered hp ha hb trace r exec,done⟩
end Inv48.RequestDispatch
