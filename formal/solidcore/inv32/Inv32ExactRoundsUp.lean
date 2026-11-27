import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.RoundsUp
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_Math_unsignedRoundsUp(uint8)#[SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_skip,
     Stmt_skip,
     Stmt_block
       (seq [Stmt_returnValues
          (seq [Expr_binary
             (BinaryOp_eq)
             (Expr_castOp
               (CastKind_uintCleanup)
               (lit 8)
               (Expr_castOp
                 (CastKind_uintCleanup)
                 (lit 8)
                 (Expr_binary
                   (BinaryOp_mod)
                   (Expr_castOp
                     (CastKind_uintCast)
                     (lit 8)
                     (Expr_var (lit "rounding")))
                   (Expr_castOp
                     (CastKind_uintCast)
                     (lit 8)
                     (Expr_word (lit 2))))))
             (Expr_castOp
               (CastKind_uintCast)
               (lit 8)
               (Expr_word (lit 1)))])])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.RoundsUp
