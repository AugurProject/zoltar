import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Mul512
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_Math_mul512(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "a"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "a"))),
     Stmt_assign
       (LValue_var (lit "b"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "b"))),
     Stmt_skip,
     Stmt_skip,
     Stmt_block
       (seq [Stmt_unchecked
          (Stmt_block
            (seq [Stmt_varDecl (Ty_uint256) (lit "mm") Option_none,
             Stmt_ifElse
               (Expr_binary
                 (BinaryOp_eq)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_unary
                       (UnaryOp_bitNot)
                       (Expr_word (lit 0)))))
                 (Expr_word (lit 0)))
               (Stmt_assign
                 (LValue_var (lit "mm"))
                 (Expr_word (lit 0)))
               (Stmt_assign
                 (LValue_var (lit "mm"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_mulMod
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_var (lit "a")))
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_var (lit "b")))
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_unary
                           (UnaryOp_bitNot)
                           (Expr_word (lit 0)))))))),
             Stmt_assign
               (LValue_var (lit "low"))
               (Expr_castOp
                 (CastKind_uintCleanup)
                 (lit 256)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_binary
                     (BinaryOp_mul)
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_var (lit "a")))
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_var (lit "b")))))),
             Stmt_assign
               (LValue_var (lit "high"))
               (Expr_castOp
                 (CastKind_uintCleanup)
                 (lit 256)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_binary
                     (BinaryOp_sub)
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_binary
                           (BinaryOp_sub)
                           (Expr_castOp
                             (CastKind_uintCleanup)
                             (lit 256)
                             (Expr_var (lit "mm")))
                           (Expr_castOp
                             (CastKind_uintCleanup)
                             (lit 256)
                             (Expr_var (lit "low"))))))
                     (Expr_ternary
                       (Expr_binary
                         (BinaryOp_lt)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_var (lit "mm")))
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_var (lit "low"))))
                       (Expr_word (lit 1))
                       (Expr_word (lit 0))))))]))])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Mul512
