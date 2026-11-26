import Inv08SearchBoundary
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Expiry
private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem linked : Inv32Library.LinkAt model.core.table key [.word "timestamp"] [.word "_ret0"] body.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) generatedBody

theorem latestFits (s : State) : stored s .latest < 2^48 := by
  change SolidCore.Solidity.Shared.norm (_ % 2^48) < 2^48
  have low (n : Nat) : SolidCore.Solidity.Shared.norm (n % 2^48) < 2^48 := by
    have small := Nat.mod_lt n (by decide : 0<2^48)
    rwa [show SolidCore.Solidity.Shared.norm (n % 2 ^ 48) = n % 2^48 from Nat.mod_eq_of_lt (lt_trans small (by decide))]
  exact low _

def fromState (s : State) (tm : Nat) := selected (endsAt s) tm (stored s .settled) (stored s .latest)

theorem call (n : Nat) (c : Context) (r : Runtime) (arg : String) (targets : List String) (tm : Nat)
    (T : r.lookupLocal? arg=some (.word tm)) (tf : tm<2^48)
    (fields : c.storageFields=model.core.context.storageFields) (ordered : stored r.state .settled≤stored r.state .latest)
    (paid : stored r.state .settled=0 ∨ endsAt r.state (stored r.state .settled)≤tm) :
    Stmt.eval (n+58) model.core.table c r (.internalCall targets key [.var arg]) =
      internalCallAssign r targets [.word (fromState r.state tm)] := by
  obtain ⟨fn,link,ps,rs,bd⟩ := linked
  let empty := {r with locals := []}
  let src := entry empty tm
  have enter : internalCallEnter? fn [.word tm] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,entry,empty,src,Runtime.withFrame]
  have args : Expr.evalRefArgList c r [.var arg] = pure ([.word tm],r) := by
    change Expr.evalRefArgListFuel (_+1) c r _ = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ T,pb]
  have E := execute n model.core.table {c with checked:=true} empty tm (stored r.state .settled) (stored r.state .latest)
    rfl tf fields rfl rfl ordered paid (latestFits _)
  change Stmt.eval _ _ _ src _ = _ at E
  rw [←bd] at E
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args link enter E]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,
    empty,entry,Runtime.withFrame,fromState]

/-- The actual generated internal call returns exactly the greatest funded
expiry reached by the requested timestamp, or zero if no stream has expired. -/
theorem correct (n : Nat) (c : Context) (r : Runtime) (arg : String) (targets : List String) (tm : Nat)
    (T : r.lookupLocal? arg=some (.word tm)) (tf : tm<2^48)
    (fields : c.storageFields=model.core.context.storageFields) (ordered : stored r.state .settled≤stored r.state .latest)
    (paid : stored r.state .settled=0 ∨ endsAt r.state (stored r.state .settled)≤tm)
    (sorted : ∀ i j, 0<i → i≤j → j≤stored r.state .latest → endsAt r.state i≤endsAt r.state j) :
    ∃ q, Stmt.eval (n+58) model.core.table c r (.internalCall targets key [.var arg]) =
      internalCallAssign r targets [.word q] ∧ stored r.state .settled≤q ∧ q≤stored r.state .latest ∧
      ∀ i, 0<i → i≤stored r.state .latest → (endsAt r.state i≤tm ↔ i≤q) :=
  ⟨fromState r.state tm,call n c r arg targets tm T tf fields ordered paid,
   selectedBoundary _ _ _ _ ordered paid (latestFits _) sorted⟩
end Inv08.Expiry
