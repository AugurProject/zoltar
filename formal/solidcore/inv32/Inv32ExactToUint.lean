import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.ToUint
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_SafeCast_toUint(bool)#[SolidCore.Solidity.Ty.bool]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_skip,
     Stmt_skip,
     Stmt_block
       (seq [Stmt_unchecked
          (Stmt_block
            (seq [Stmt_ifElse
               (Expr_binary
                 (BinaryOp_eq)
                 (Expr_ternary
                   (Expr_binary
                     (BinaryOp_eq)
                     (Expr_ternary
                       (Expr_var (lit "b"))
                       (Expr_word (lit 1))
                       (Expr_word (lit 0)))
                     (Expr_word (lit 0)))
                   (Expr_word (lit 1))
                   (Expr_word (lit 0)))
                 (Expr_word (lit 0)))
               (Stmt_assign
                 (LValue_var (lit "u"))
                 (Expr_word (lit 1)))
               (Stmt_assign
                 (LValue_var (lit "u"))
                 (Expr_word (lit 0)))]))])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.ToUint
