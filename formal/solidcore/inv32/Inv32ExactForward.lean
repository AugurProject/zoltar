import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Forward
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_TwoWayConstantProductMath_quoteExactInput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"

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
       (LValue_var (lit "amountIn"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "amountIn"))),
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
            (BinaryOp_gt)
            (Expr_castOp
              (CastKind_uintCleanup)
              (lit 256)
              (Expr_var (lit "amountIn")))
            (Expr_word (lit 0)))
          (Option_some (lit "Input is zero")),
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
                (Expr_var (lit "amountIn")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_1")
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
             (lit "_ic_arg_2")
             (Option_some (Expr_ternary
                (Expr_word (lit 1))
                (Expr_word (lit 10000))
                (Expr_word (lit 10000)))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ret___library_Math_mulDiv_0")
             Option_none,
           Stmt_captureReturn
             (seq [(lit "_ret___library_Math_mulDiv_0")])
             (Stmt_internalCall
               (seq [(lit "_ret___library_Math_mulDiv_0")])
               (lit "__internal___library_Math_mulDiv(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
               (seq [Expr_var (lit "_ic_arg_0"),
                Expr_var (lit "_ic_arg_1"),
                Expr_var (lit "_ic_arg_2")])),
           Stmt_assign
             (LValue_var (lit "_sol_hoist_0"))
             (Expr_var (lit "_ret___library_Math_mulDiv_0"))]),
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
        Stmt_requireStmt
          (Expr_binary
            (BinaryOp_gt)
            (Expr_castOp
              (CastKind_uintCleanup)
              (lit 256)
              (Expr_var (lit "netInput")))
            (Expr_word (lit 0)))
          (Option_some (lit "Net input is zero")),
        Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none,
        Stmt_block
          (seq [Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_0")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "reserveOut")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_1")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "netInput")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_2")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "reserveIn")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ret___library_TwoWayConstantProductMath__ratioOfSum_0")
             Option_none,
           Stmt_captureReturn
             (seq [(lit "_ret___library_TwoWayConstantProductMath__ratioOfSum_0")])
             (Stmt_internalCall
               (seq [(lit "_ret___library_TwoWayConstantProductMath__ratioOfSum_0")])
               (lit "__internal___library_TwoWayConstantProductMath__ratioOfSum(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
               (seq [Expr_var (lit "_ic_arg_0"),
                Expr_var (lit "_ic_arg_1"),
                Expr_var (lit "_ic_arg_2")])),
           Stmt_assign
             (LValue_var (lit "_sol_hoist_0"))
             (Expr_var (lit "_ret___library_TwoWayConstantProductMath__ratioOfSum_0"))]),
        Stmt_assign
          (LValue_var (lit "amountOut"))
          (Expr_castOp
            (CastKind_uintCleanup)
            (lit 256)
            (Expr_var (lit "_sol_hoist_0"))),
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
          (Option_some (lit "Insufficient output")),
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
end Inv32Bodies.Forward
