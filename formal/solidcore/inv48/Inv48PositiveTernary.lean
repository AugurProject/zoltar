import Inv48PositiveTernaryCore
import Inv48PositiveTernaryLink
import Inv48FeedMathLinks
namespace Inv48.PositiveTernary
abbrev execute := Inv48.PositiveTernaryCore.execute Inv48.Source.model.core.table Inv48.FeedMath.uintLinked
abbrev call := Inv48.PositiveTernaryCore.call Inv48.Source.model.core.table linked Inv48.FeedMath.uintLinked
end Inv48.PositiveTernary
