import Inv12Model
import Inv08Members
open SolidCore.Solidity.Source Inv03.Bodies Inv32Shapes
namespace Inv12
def member (name : String) (i : Nat) := clean (Inv08.Integral.member name i)
def quotient := hoist Inv32Bodies.Floor.key Inv32FloorHoist.ret [(Inv32FloorHoist.a0,member "fork" 2),
  (Inv32FloorHoist.a1,member "branch" 5),(Inv32FloorHoist.a2,member "fork" 1)]
private def parentCash : Pattern LValue :=
  ⟨.index (.var "branch") (.word 6), fun | .index (.var "branch") (.word 6) => true | _ => false,
    by intro v h; dsimp only at h; split at h <;> simp_all⟩
def writeCash := Stmt_assign parentCash copied
def missingGuard : Stmt → Bool
  | .requireStmt _ (some "Fork commitment missing") => true
  | _ => false
def allocationCode : Option (List Stmt) := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block stmts),_]]] := fn.body | none
  let _::code := stmts.dropWhile (fun s => !missingGuard s) | none
  pure (code.take 3)
theorem fromCoordinator : allocationCode=some [(decl tmp Option_none).value,quotient.value,writeCash.value] :=
  (Option_some (seq [decl tmp Option_none,quotient,writeCash])).sound _ (by native_decide)
end Inv12
