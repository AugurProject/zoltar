import Inv48Model
import Inv32Shapes
import Inv32ExactTernary
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.PositiveMax
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
abbrev key := "__internal___library_Math_max(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def w (s : String) := Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit s))
def cleanParam (s : String) := Stmt_assign (LValue_var (lit s)) (w s)
abbrev out := "_sol_hoist_0"
abbrev ret := "_ret___library_Math_ternary_0"
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
def stageShape : Pattern Stmt := Stmt_block (seq [
  Stmt_varDecl Ty_bool (lit a0) (Option_some (Expr_binary BinaryOp_gt (w "a") (w "b"))),
  Stmt_varDecl Ty_uint256 (lit a1) (Option_some (w "a")),
  Stmt_varDecl Ty_uint256 (lit a2) (Option_some (w "b")),
  Stmt_varDecl Ty_uint256 (lit ret) Option_none,
  Stmt_captureReturn (seq [lit ret]) (Stmt_internalCall (seq [lit ret]) (lit Inv32Bodies.Ternary.key)
    (seq [Expr_var (lit a0),Expr_var (lit a1),Expr_var (lit a2)])),
  Stmt_assign (LValue_var (lit out)) (Expr_var (lit ret))])
def shape : Pattern Stmt := Stmt_block (seq [cleanParam "a",cleanParam "b",Stmt_skip,
  Stmt_block (seq [Stmt_varDecl Ty_uint256 (lit out) Option_none,stageShape,
    Stmt_returnValues (seq [w out])])])
def body := shape.value

theorem linked : Inv32Library.LinkAt Inv48.Source.model.core.table key
    [.word "a",.word "b"] [.word "_ret0"] body :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide)
    ((Option_some shape).sound _ (by native_decide))
#print axioms linked
end Inv48.PositiveMax
