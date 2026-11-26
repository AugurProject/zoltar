import Inv03Bodies
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv05
def key := "__internal___library_SecurityPoolSettlementMath_mintUnits(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
private def neP : Pattern BinaryOp :=
  ⟨.ne,fun | .ne => true | _ => false,by intro op h; cases op <;> first | rfl | cases h⟩
private def geP : Pattern BinaryOp :=
  ⟨.ge,fun | .ge => true | _ => false,by intro op h; cases op <;> first | rfl | cases h⟩
def floor (x y d : Pattern Expr) := hoist Inv32Bodies.Floor.key Inv32FloorHoist.ret
  [(Inv32FloorHoist.a0,x),(Inv32FloorHoist.a1,y),(Inv32FloorHoist.a2,d)]
def nz (name : String) := Expr_binary neP (wvar name) (num 0)
def scale (x : Pattern Expr) := clean (clean (Expr_binary BinaryOp_mul x (Expr_ternary (num 1) (num (10^9)) (num (10^9)))))
def previous := scale (clean (clean (Expr_binary BinaryOp_sub (wvar "cash") (num 1))))
def precisionCheck := block [decl "_sol_hoist_1" (Option_some previous),decl tmp Option_none,
  floor (wvar "added") (wvar "net") (wvar "units"),
  assign "_sol_hoist_2" (Expr_binary geP copied (wvar "_sol_hoist_1"))]
def shape := block [param "cash",param "units",param "net",Stmt_skip,block [
  Stmt_ifElse (Expr_binary BinaryOp_eq (wvar "cash") (num 0)) (ret (num 0)) Stmt_skip,
  Stmt_ifElse (Expr_binary BinaryOp_eq (wvar "units") (num 0)) (ret (scale (wvar "cash"))) Stmt_skip,
  Stmt_requireStmt (nz "net") (Option_some (lit "Settlement backing exhausted")),
  decl tmp Option_none,floor (scale (wvar "cash")) (wvar "units") (wvar "net"),assign "added" copied,
  Stmt_varDecl Ty_bool (lit "_sol_hoist_2") (Option_some (nz "added")),
  Stmt_ifElse (varP "_sol_hoist_2") precisionCheck Stmt_skip,
  Stmt_requireStmt (varP "_sol_hoist_2") (Option_some (lit "Settlement purchase below unit precision"))]]
theorem mintBody : Inv32Library.LinkAt Inv03.model.core.table key [.word "cash",.word "units",.word "net"]
    [.word "added"] shape.value := Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some shape).sound _ (by native_decide))
end Inv05
