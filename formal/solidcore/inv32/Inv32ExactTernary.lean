import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Ternary
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_Math_ternary(bool,uint256,uint256)#[SolidCore.Solidity.Ty.bool, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_skip,
     Stmt_assign
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
     Stmt_block
       (seq [Stmt_unchecked
          (Stmt_block
            (seq [Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none,
             Stmt_block
               (seq [Stmt_varDecl
                  (Ty_bool)
                  (lit "_ic_arg_0")
                  (Option_some (Expr_var (lit "condition"))),
                Stmt_varDecl
                  (Ty_uint256)
                  (lit "_ret___library_SafeCast_toUint_0")
                  Option_none,
                Stmt_captureReturn
                  (seq [(lit "_ret___library_SafeCast_toUint_0")])
                  (Stmt_internalCall
                    (seq [(lit "_ret___library_SafeCast_toUint_0")])
                    (lit "__internal___library_SafeCast_toUint(bool)#[SolidCore.Solidity.Ty.bool]")
                    (seq [Expr_var (lit "_ic_arg_0")])),
                Stmt_assign
                  (LValue_var (lit "_sol_hoist_0"))
                  (Expr_var (lit "_ret___library_SafeCast_toUint_0"))]),
             Stmt_returnValues
               (seq [Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_binary
                    (BinaryOp_bitXor)
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
                        (Expr_binary
                          (BinaryOp_mul)
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_binary
                              (BinaryOp_bitXor)
                              (Expr_castOp
                                (CastKind_uintCleanup)
                                (lit 256)
                                (Expr_var (lit "a")))
                              (Expr_castOp
                                (CastKind_uintCleanup)
                                (lit 256)
                                (Expr_var (lit "b")))))
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_castOp
                              (CastKind_uintCast)
                              (lit 256)
                              (Expr_var (lit "_sol_hoist_0"))))))))])]))])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Ternary
