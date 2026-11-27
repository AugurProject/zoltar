import Inv48PositiveMaxCore
import Inv48PositiveMaxShape
import Inv48PositiveTernary
namespace Inv48.PositiveMax
abbrev execute := Inv48.PositiveMaxCore.execute Inv48.Source.model.core.table Inv48.PositiveTernary.linked Inv48.FeedMath.uintLinked
abbrev call := Inv48.PositiveMaxCore.call Inv48.Source.model.core.table linked Inv48.PositiveTernary.linked Inv48.FeedMath.uintLinked
end Inv48.PositiveMax
