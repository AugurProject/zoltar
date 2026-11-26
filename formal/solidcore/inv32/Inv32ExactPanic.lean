import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Panic
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_Panic_panic(uint256)#[SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "code"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "code"))),
     Stmt_block
       (seq [Stmt_revert (lit "#yul.panic") (seq [Expr_var (lit "code")])])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Panic
