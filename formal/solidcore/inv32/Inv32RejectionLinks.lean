import Inv32Library
open SolidCore.Solidity.Source
namespace Inv32Rejection
structure Links (t : FunctionTable) where
  product : Inv32Internal.ProductLinked t
  floor : Inv32FloorCall.FloorLinked t
  uint : Inv32Library.LinkAt t Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body
  ternary : Inv32Library.LinkAt t Inv32Bodies.Ternary.key [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Inv32Bodies.Ternary.body
  panic : Inv32Library.LinkAt t Inv32Bodies.Panic.key [.word "code"] [] Inv32Bodies.Panic.body
def trading : Links Inv32Dispatch.model.core.table :=
  ⟨Inv32Internal.signature,Inv32FloorCall.sig,Inv32Library.linkToUint,Inv32Library.linkTernary,Inv32Library.linkPanic⟩
end Inv32Rejection
