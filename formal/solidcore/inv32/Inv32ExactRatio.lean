import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Ratio
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_TwoWayConstantProductMath__ratioOfSum(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "scale"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "scale"))),
     Stmt_assign
       (LValue_var (lit "numeratorPart"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "numeratorPart"))),
     Stmt_assign
       (LValue_var (lit "otherPart"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "otherPart"))),
     Stmt_skip,
     Stmt_block
       (seq [Stmt_block
          (seq [Stmt_varDecl
             (Ty_uint256)
             (lit "#operand3764")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "otherPart")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "#operand3769")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_word
                  (lit 115792089237316195423570985008687907853269984665640564039457584007913129639935)))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "#operand3770")
             (Option_some (Expr_castOp
                (CastKind_uintCleanup)
                (lit 256)
                (Expr_var (lit "numeratorPart")))),
           Stmt_varDecl
             (Ty_uint256)
             (lit "#operand3771")
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
                      (Expr_var (lit "#operand3769")))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "#operand3770"))))))),
           Stmt_ifElse
             (Expr_binary
               (BinaryOp_le)
               (Expr_castOp
                 (CastKind_uintCleanup)
                 (lit 256)
                 (Expr_var (lit "#operand3764")))
               (Expr_castOp
                 (CastKind_uintCleanup)
                 (lit 256)
                 (Expr_var (lit "#operand3771"))))
             (Stmt_block
               (seq [Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none,
                Stmt_block
                  (seq [Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_0")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "scale")))),
                   Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_1")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "numeratorPart")))),
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
                            (BinaryOp_add)
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_var (lit "otherPart")))
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_var (lit "numeratorPart"))))))),
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
                Stmt_returnValues
                  (seq [Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_castOp
                       (CastKind_uintCast)
                       (lit 256)
                       (Expr_var (lit "_sol_hoist_0")))])]))
             (Stmt_skip)]),
        Stmt_varDecl (Ty_uint256) (lit "low") Option_none,
        Stmt_varDecl
          (Ty_uint256)
          (lit "high")
          (Option_some (Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "scale")))),
        Stmt_whileLoop
          (Expr_binary
            (BinaryOp_lt)
            (Expr_castOp
              (CastKind_uintCleanup)
              (lit 256)
              (Expr_var (lit "low")))
            (Expr_castOp
              (CastKind_uintCleanup)
              (lit 256)
              (Expr_var (lit "high"))))
          (Stmt_block
            (seq [Stmt_varDecl
               (Ty_uint256)
               (lit "midpoint")
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
                        (Expr_castOp
                          (CastKind_uintCleanup)
                          (lit 256)
                          (Expr_binary
                            (BinaryOp_add)
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_var (lit "low")))
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_castOp
                                (CastKind_uintCleanup)
                                (lit 256)
                                (Expr_binary
                                  (BinaryOp_div)
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
                                          (Expr_var (lit "high")))
                                        (Expr_castOp
                                          (CastKind_uintCleanup)
                                          (lit 256)
                                          (Expr_var (lit "low"))))))
                                  (Expr_word (lit 2))))))))
                      (Expr_word (lit 1)))))),
             Stmt_block
               (seq [Stmt_varDecl (Ty_bool) (lit "_sol_hoist_0") Option_none,
                Stmt_block
                  (seq [Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_0")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "midpoint")))),
                   Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_1")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "otherPart")))),
                   Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_2")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "numeratorPart")))),
                   Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_3")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "scale")))),
                   Stmt_varDecl
                     (Ty_uint256)
                     (lit "_ic_arg_4")
                     (Option_some (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_var (lit "numeratorPart")))),
                   Stmt_varDecl
                     (Ty_bool)
                     (lit "_ret___library_TwoWayConstantProductMath__productOfSumAtMost_0")
                     Option_none,
                   Stmt_captureReturn
                     (seq [(lit "_ret___library_TwoWayConstantProductMath__productOfSumAtMost_0")])
                     (Stmt_internalCall
                       (seq [(lit "_ret___library_TwoWayConstantProductMath__productOfSumAtMost_0")])
                       (lit "__internal___library_TwoWayConstantProductMath__productOfSumAtMost(uint256,uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]")
                       (seq [Expr_var (lit "_ic_arg_0"),
                        Expr_var (lit "_ic_arg_1"),
                        Expr_var (lit "_ic_arg_2"),
                        Expr_var (lit "_ic_arg_3"),
                        Expr_var (lit "_ic_arg_4")])),
                   Stmt_assign
                     (LValue_var (lit "_sol_hoist_0"))
                     (Expr_var
                       (lit "_ret___library_TwoWayConstantProductMath__productOfSumAtMost_0"))]),
                Stmt_varDecl
                  (Ty_bool)
                  (lit "#view3812")
                  (Option_some (Expr_var (lit "_sol_hoist_0"))),
                Stmt_ifElse
                  (Expr_var (lit "#view3812"))
                  (Stmt_assign
                    (LValue_var (lit "low"))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "midpoint"))))
                  (Stmt_assign
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
                            (Expr_var (lit "midpoint")))
                          (Expr_word (lit 1))))))])])),
        Stmt_returnValues
          (seq [Expr_castOp
             (CastKind_uintCleanup)
             (lit 256)
             (Expr_var (lit "low"))])])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Ratio
