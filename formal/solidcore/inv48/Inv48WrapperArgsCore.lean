import Inv48WrapperTraversalPublic
import Inv48GuardArgsFrameCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

def callArgs : List Expr := [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2",
  .var "_ic_arg_3",.var "_ic_arg_4"]
open Inv32Shapes
def callArgsP := seq [Expr_var (lit "_ic_arg_0"),Expr_var (lit "_ic_arg_1"),
  Expr_var (lit "_ic_arg_2"),Expr_var (lit "_ic_arg_3"),Expr_var (lit "_ic_arg_4")]
def inputs (s p a b g : Nat) : List Value := [.word s,.word p,.word a,.word b,.word g]
def TempValues (r : Runtime) (s p a b g : Nat) : Prop :=
  r.lookupLocal? "_ic_arg_0" = some (.word s) ∧
  r.lookupLocal? "_ic_arg_1" = some (.word p) ∧
  r.lookupLocal? "_ic_arg_2" = some (.word a) ∧
  r.lookupLocal? "_ic_arg_3" = some (.word b) ∧
  r.lookupLocal? "_ic_arg_4" = some (.word g)

/-- Evaluation, rather than occurrence: all five scalar arguments are evaluated
left to right without changing the caller runtime. This is intentionally a
local lemma; it does not derive TempValues from ABI decoding. -/
theorem evaluated (c : Context) (r : Runtime) (s p a b g : Nat)
    (h : TempValues r s p a b g) :
    Expr.evalRefArgList c r callArgs = pure (inputs s p a b g,r) := by
  rcases h with ⟨S,P,A,B,G⟩
  unfold Expr.evalRefArgList callArgs
  simp only [Expr.listEvalFuel,Expr.orderFuel]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ s S]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ p P]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ a A]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ b B]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ g G]
  simp only [pb]
  rw [Expr.evalRefArgListFuel]
  rfl

end Inv48.WrapperArgs
