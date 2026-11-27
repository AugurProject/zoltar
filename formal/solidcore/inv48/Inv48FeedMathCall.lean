import Inv48FeedMathLinks
import Inv48QuoteExecMath
namespace Inv48.FeedMath
abbrev rounded := QuoteExecMath.rounded
theorem roundedCeil (x y d : Nat) (hp : 0<d) :
    QuoteExecMath.rounded x y d true = Inv03.ceilQuot (x*y) d := QuoteExecMath.roundedCeil x y d hp
theorem roundedFloor (x y d : Nat) : QuoteExecMath.rounded x y d false = x*y/d := QuoteExecMath.roundedFloor x y d
abbrev roundedCall := QuoteExecMath.roundedCall productLinked floorLinked roundsLinked uintLinked roundedLinked
#print axioms roundedCall
end Inv48.FeedMath
