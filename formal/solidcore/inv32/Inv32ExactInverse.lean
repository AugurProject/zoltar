import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Inverse
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_TwoWayConstantProductMath_quoteExactOutput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "reserveIn"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "reserveIn"))),
     Stmt_assign
       (LValue_var (lit "reserveOut"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "reserveOut"))),
     Stmt_assign
       (LValue_var (lit "amountOut"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "amountOut"))),
     Stmt_assign
       (LValue_var (lit "feeBps"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "feeBps"))),
     Stmt_skip,
     Stmt_skip,
     Stmt_block
       (seq [Stmt_requireStmt
          (Expr_binary
            (BinaryOp_boolAnd)
            (Expr_binary
              (BinaryOp_gt)
              (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "reserveIn")))
              (Expr_word (lit 0)))
            (Expr_binary
              (BinaryOp_gt)
              (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "reserveOut")))
              (Expr_word (lit 0))))
          (Option_some (lit "Empty reserves")),
        Stmt_requireStmt
          (Expr_binary
            (BinaryOp_boolAnd)
            (Expr_binary
              (BinaryOp_gt)
              (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "amountOut")))
              (Expr_word (lit 0)))
            (Expr_binary
              (BinaryOp_lt)
              (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "amountOut")))
              (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "reserveOut")))))
          (Option_some (lit "Invalid output")),
        Stmt_requireStmt
          (Expr_binary
            (BinaryOp_lt)
            (Expr_castOp
              (CastKind_uintCleanup)
              (lit 256)
              (Expr_var (lit "feeBps")))
            (Expr_ternary
              (Expr_word (lit 1))
              (Expr_word (lit 10000))
              (Expr_word (lit 10000))))
          (Option_some (lit "Invalid fee")),
        Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none,
        Stmt_block
          (seq [Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_0")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "reserveIn")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_1")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "amountOut")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_2")
             (Option_some (Expr_castOp
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
                      (Expr_var (lit "reserveOut")))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "amountOut"))))))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_3")
             (Option_some (Expr_enumFromUInt
                (lit 3)
                (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_word (lit 1))))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ret___library_Math_mulDiv_overload_1_0")
             Option_none,
           Stmt_captureReturn
             (seq [(lit "_ret___library_Math_mulDiv_overload_1_0")])
             (Stmt_internalCall
               (seq [(lit "_ret___library_Math_mulDiv_overload_1_0")])
               (lit "__internal___library_Math_mulDiv_overload_1(uint256,uint256,uint256,uint8)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]")
               (seq [Expr_var (lit "_ic_arg_0"),
                Expr_var (lit "_ic_arg_1"),
                Expr_var (lit "_ic_arg_2"),
                Expr_var (lit "_ic_arg_3")])),
           Stmt_assign
             (LValue_var (lit "_sol_hoist_0"))
             (Expr_var (lit "_ret___library_Math_mulDiv_overload_1_0"))]),
        Stmt_varDecl
          (Ty_uint256)
          (lit "netInput")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_castOp
               (CastKind_uintCast)
               (lit 256)
               (Expr_var (lit "_sol_hoist_0"))))),
        Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none,
        Stmt_block
          (seq [Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_0")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "netInput")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_1")
             (Option_some (Expr_ternary
                (Expr_word (lit 1))
                (Expr_word (lit 10000))
                (Expr_word (lit 10000)))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_2")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_binary
                    (BinaryOp_sub)
                    (Expr_ternary
                      (Expr_word (lit 1))
                      (Expr_word (lit 10000))
                      (Expr_word (lit 10000)))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "feeBps"))))))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_3")
             (Option_some (Expr_enumFromUInt
                (lit 3)
                (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_word (lit 1))))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ret___library_Math_mulDiv_overload_1_0")
             Option_none,
           Stmt_captureReturn
             (seq [(lit "_ret___library_Math_mulDiv_overload_1_0")])
             (Stmt_internalCall
               (seq [(lit "_ret___library_Math_mulDiv_overload_1_0")])
               (lit "__internal___library_Math_mulDiv_overload_1(uint256,uint256,uint256,uint8)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]")
               (seq [Expr_var (lit "_ic_arg_0"),
                Expr_var (lit "_ic_arg_1"),
                Expr_var (lit "_ic_arg_2"),
                Expr_var (lit "_ic_arg_3")])),
           Stmt_assign
             (LValue_var (lit "_sol_hoist_0"))
             (Expr_var (lit "_ret___library_Math_mulDiv_overload_1_0"))]),
        Stmt_assign
          (LValue_var (lit "amountIn"))
          (Expr_castOp
            (CastKind_uintCleanup)
            (lit 256)
            (Expr_castOp
              (CastKind_uintCast)
              (lit 256)
              (Expr_var (lit "_sol_hoist_0")))),
        Stmt_assign
          (LValue_var (lit "feeAmount"))
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
                  (Expr_var (lit "amountIn")))
                (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_var (lit "netInput"))))))])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Inverse
