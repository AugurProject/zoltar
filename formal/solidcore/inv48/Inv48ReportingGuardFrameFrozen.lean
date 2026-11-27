import Inv48ReportingGuardFrameSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem assoc {α β γ : Type} (tree : SolI α) (f : α → SolI β) (g : β → SolI γ) :
    ((tree >>= f) >>= g) = (tree >>= fun x => f x >>= g) := Interaction.bind_assoc tree f g

theorem frozenLift {α β : Type} (r : Runtime) (e : Except RevertData α)
    (k : α → SolI (β × Runtime)) (safe : ∀ a, Frozen r (k a)) :
    Frozen r (do let a ← e; k a) := by
  cases e with
  | error err => exact ⟨.error (.revert err),rfl⟩
  | ok a => exact safe a

theorem frozenBind {α β : Type} (r : Runtime) (tree : SolI (α × Runtime))
    (k : α × Runtime → SolI (β × Runtime)) (first : Frozen r tree)
    (safe : ∀ a, Frozen r (k (a,r))) : Frozen r (tree >>= k) := by
  obtain ⟨result,eq⟩ := first
  rw [eq]
  cases result with
  | error err => exact ⟨.error err,rfl⟩
  | ok a => exact safe a

theorem castVarFrozen (c : Context) (r : Runtime) (name : String) :
    Frozen r (Expr.eval c r (.castOp .uintCast 248 (.var name))) := by
  unfold Expr.eval
  rw [Expr.evalFuel]
  change Frozen r (Expr.eval c r (.var name) >>= _)
  apply frozenBind r _ _ (varFrozen c r name)
  intro value
  exact frozenLift r (uintCast? 248 value) _ (fun v => ⟨.ok v,rfl⟩)

theorem calldataFrozen (c : Context) (r : Runtime) : Frozen r (Expr.eval c r calldataP.value) := by
  change Frozen r (Expr.eval c r (.encode .withSelector (some (.word 3365542311)) []
    [.uint256] [.castOp .uintCast 248 (.var "#view47899")]))
  unfold Expr.eval
  simp only [Expr.orderFuel]
  rw [Expr.evalFuel]
  try simp only [Expr.listEvalFuel,Expr.orderFuel]
  rw [Expr.evalListFuel,Expr.evalFuel]
  simp only [pb]
  rw [assoc]
  try simp only [Expr.listEvalFuel,Expr.orderFuel]
  rw [Expr.evalListFuel]
  rw [assoc]
  change Frozen r (Expr.eval c r (.castOp .uintCast 248 (.var "#view47899")) >>= _)
  apply frozenBind r _ _ (castVarFrozen c r "#view47899")
  intro value
  try simp only [pb]
  try simp only [Expr.listEvalFuel,Expr.orderFuel]
  rw [Expr.evalListFuel]
  simp only [pb]
  change Frozen r (do
    let selector ← (Value.word (normWord 3365542311)).expectWord
    let values ← r.materializeForValueUseList c [value]
    match abiEncodeValues? [.uint256] values with
    | some bytes => pure (Value.bytes (wordToBytesBE selectorBytes selector ++ bytes),r)
    | none => throw (SolidityFailure.revert .typeMismatch))
  apply frozenLift r _ _
  intro selector
  apply frozenLift r _ _
  intro values
  cases abiEncodeValues? [.uint256] values with
  | none => exact ⟨.error (.revert .typeMismatch),rfl⟩
  | some bytes => exact ⟨.ok _,rfl⟩

theorem foldedFrozen (c : Context) (r : Runtime) (e : Expr)
    (frozen : Frozen r (Expr.eval c r e)) :
    ∃ result : Except RevertData Value,
      e.evalWithRuntimeByContext c r = result.map (fun v => (v,r)) := by
  obtain ⟨result,eq⟩ := frozen
  unfold Expr.evalWithRuntimeByContext
  rw [eq]
  cases result with
  | ok v => exact ⟨.ok v,rfl⟩
  | error err => cases err <;> exact ⟨.error _,rfl⟩
end Inv48.ReportingGuardFrame
