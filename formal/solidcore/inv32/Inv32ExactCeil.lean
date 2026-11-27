import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Ceil
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_Math_mulDiv_overload_1(uint256,uint256,uint256,uint8)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "x"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "x"))),
     Stmt_assign
       (LValue_var (lit "y"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "y"))),
     Stmt_assign
       (LValue_var (lit "denominator"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "denominator"))),
     Stmt_skip,
     Stmt_skip,
     Stmt_block
       (seq [Stmt_varDecl (Ty_bool) (lit "_sol_hoist_0") Option_none,
        Stmt_block
          (seq [Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_0")
             (Option_some (Expr_var (lit "rounding"))),
           Stmt_varDecl
             (Ty_bool)
             (lit "_ret___library_Math_unsignedRoundsUp_0")
             Option_none,
           Stmt_captureReturn
             (seq [(lit "_ret___library_Math_unsignedRoundsUp_0")])
             (Stmt_internalCall
               (seq [(lit "_ret___library_Math_unsignedRoundsUp_0")])
               (lit "__internal___library_Math_unsignedRoundsUp(uint8)#[SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]")
               (seq [Expr_var (lit "_ic_arg_0")])),
           Stmt_assign
             (LValue_var (lit "_sol_hoist_0"))
             (Expr_var (lit "_ret___library_Math_unsignedRoundsUp_0"))]),
        Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_1") Option_none,
        Stmt_block
          (seq [Stmt_varDecl
             (Ty_bool)
             (lit "_ic_arg_0")
             (Option_some (Expr_binary
                (BinaryOp_boolAnd)
                (Expr_var (lit "_sol_hoist_0"))
                (Expr_binary
                  (BinaryOp_gt)
                  (Expr_castOp
                    (CastKind_uintCleanup)
                    (lit 256)
                    (Expr_mulMod
                      (Expr_var (lit "x"))
                      (Expr_var (lit "y"))
                      (Expr_var (lit "denominator"))))
                  (Expr_word (lit 0))))),
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
             (LValue_var (lit "_sol_hoist_1"))
             (Expr_var (lit "_ret___library_SafeCast_toUint_0"))]),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_sol_hoist_3")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_castOp
               (CastKind_uintCast)
               (lit 256)
               (Expr_var (lit "_sol_hoist_1"))))),
        Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_2") Option_none,
        Stmt_block
          (seq [Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_0")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "x")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_1")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "y")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "_ic_arg_2")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "denominator")))),
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
             (LValue_var (lit "_sol_hoist_2"))
             (Expr_var (lit "_ret___library_Math_mulDiv_0"))]),
        Stmt_returnValues
          (seq [Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_castOp
               (CastKind_uintCleanup)
               (lit 256)
               (Expr_binary
                 (BinaryOp_add)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "_sol_hoist_2")))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "_sol_hoist_3")))))])])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Ceil
