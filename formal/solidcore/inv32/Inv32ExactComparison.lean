import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Comparison
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_TwoWayConstantProductMath__productOfSumAtMost(uint256,uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "multiplier"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "multiplier"))),
     Stmt_assign
       (LValue_var (lit "first"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "first"))),
     Stmt_assign
       (LValue_var (lit "second"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "second"))),
     Stmt_assign
       (LValue_var (lit "rightMultiplier"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "rightMultiplier"))),
     Stmt_assign
       (LValue_var (lit "rightValue"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "rightValue"))),
     Stmt_skip,
     Stmt_block
       (seq [Stmt_varDecl (Ty_uint256) (lit "firstHigh") Option_none,
        Stmt_varDecl (Ty_uint256) (lit "firstLow") Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ic_arg_0")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "multiplier")))),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ic_arg_1")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "first")))),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ret___library_Math_mul512_0")
          Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ret___library_Math_mul512_1")
          Option_none,
        Stmt_captureReturn
          (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
          (Stmt_internalCall
            (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
            (lit "__internal___library_Math_mul512(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
            (seq [Expr_var (lit "_ic_arg_0"), Expr_var (lit "_ic_arg_1")])),
        Stmt_assign
          (LValue_var (lit "firstHigh"))
          (Expr_var (lit "_ret___library_Math_mul512_0")),
        Stmt_assign
          (LValue_var (lit "firstLow"))
          (Expr_var (lit "_ret___library_Math_mul512_1")),
        Stmt_varDecl (Ty_uint256) (lit "secondHigh") Option_none,
        Stmt_varDecl (Ty_uint256) (lit "secondLow") Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ic_arg_0")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "multiplier")))),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ic_arg_1")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "second")))),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ret___library_Math_mul512_0")
          Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ret___library_Math_mul512_1")
          Option_none,
        Stmt_captureReturn
          (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
          (Stmt_internalCall
            (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
            (lit "__internal___library_Math_mul512(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
            (seq [Expr_var (lit "_ic_arg_0"), Expr_var (lit "_ic_arg_1")])),
        Stmt_assign
          (LValue_var (lit "secondHigh"))
          (Expr_var (lit "_ret___library_Math_mul512_0")),
        Stmt_assign
          (LValue_var (lit "secondLow"))
          (Expr_var (lit "_ret___library_Math_mul512_1")),
        Stmt_varDecl (Ty_uint256) (lit "rightHigh") Option_none,
        Stmt_varDecl (Ty_uint256) (lit "rightLow") Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ic_arg_0")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "rightMultiplier")))),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ic_arg_1")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "rightValue")))),
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ret___library_Math_mul512_0")
          Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "_ret___library_Math_mul512_1")
          Option_none,
        Stmt_captureReturn
          (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
          (Stmt_internalCall
            (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
            (lit "__internal___library_Math_mul512(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
            (seq [Expr_var (lit "_ic_arg_0"), Expr_var (lit "_ic_arg_1")])),
        Stmt_assign
          (LValue_var (lit "rightHigh"))
          (Expr_var (lit "_ret___library_Math_mul512_0")),
        Stmt_assign
          (LValue_var (lit "rightLow"))
          (Expr_var (lit "_ret___library_Math_mul512_1")),
        Stmt_unchecked
          (Stmt_block
            (seq [Stmt_varDecl
               (Ty_uint256)
               (lit "lowSum")
               (Option_some (Expr_castOp
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
                        (Expr_var (lit "firstLow")))
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "secondLow"))))))),
             Stmt_varDecl (Ty_uint256) (lit "carry") Option_none,
             Stmt_ifElse
               (Expr_binary
                 (BinaryOp_lt)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "lowSum")))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "firstLow"))))
               (Stmt_assign
                 (LValue_var (lit "carry"))
                 (Expr_word (lit 1)))
               (Stmt_assign
                 (LValue_var (lit "carry"))
                 (Expr_word (lit 0))),
             Stmt_varDecl
               (Ty_uint256)
               (lit "highWithoutCarry")
               (Option_some (Expr_castOp
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
                        (Expr_var (lit "firstHigh")))
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "secondHigh"))))))),
             Stmt_ifElse
               (Expr_binary
                 (BinaryOp_lt)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "highWithoutCarry")))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "firstHigh"))))
               (Stmt_returnValues (seq [Expr_word (lit 0)]))
               (Stmt_skip),
             Stmt_varDecl
               (Ty_uint256)
               (lit "highSum")
               (Option_some (Expr_castOp
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
                        (Expr_var (lit "highWithoutCarry")))
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "carry"))))))),
             Stmt_ifElse
               (Expr_binary
                 (BinaryOp_lt)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "highSum")))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "highWithoutCarry"))))
               (Stmt_returnValues (seq [Expr_word (lit 0)]))
               (Stmt_skip),
             Stmt_returnValues
               (seq [Expr_binary
                  (BinaryOp_boolOr)
                  (Expr_binary
                    (BinaryOp_lt)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "highSum")))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "rightHigh"))))
                  (Expr_binary
                    (BinaryOp_boolAnd)
                    (Expr_binary
                      (BinaryOp_eq)
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "highSum")))
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "rightHigh"))))
                    (Expr_binary
                      (BinaryOp_le)
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "lowSum")))
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "rightLow")))))])]))])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Comparison
