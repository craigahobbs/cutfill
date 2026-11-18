# struct RoadPlan

A road grading plan model. A plan contains the site topography, the road start and end points, and
one or more road plan options. All lengths and elevations are in the plan's units.

| Name         | Type                                     | Attributes                 | Description                                                                                            |
|--------------|------------------------------------------|----------------------------|--------------------------------------------------------------------------------------------------------|
| title        | string                                   | len(value) > 0             | The plan title                                                                                         |
| description  | string []                                | optional                   | The plan description Markdown text lines                                                               |
| image        | string                                   | optional<br>len(value) > 0 | The source topographic map image URL, relative to the plan JSON file - or a data URL, the image itself |
| units        | [Units](#enum-units)                     |                            | The unit of all lengths and elevations                                                                 |
| georeference | [Georeference](#struct-georeference)     | optional                   | The plan's place on the Earth                                                                          |
| topography   | [Topography](#struct-topography)         |                            | The site topography                                                                                    |
| start        | [Point](#struct-point)                   |                            | The road start point                                                                                   |
| end          | [Point](#struct-point)                   |                            | The road end point                                                                                     |
| criteria     | [DesignCriteria](#struct-designcriteria) | optional                   | The road design criteria                                                                               |
| costRates    | [CostRates](#struct-costrates)           | optional                   | The cost rate overrides                                                                                |
| options      | [RoadOption](#struct-roadoption) []      | len(array) > 0             | The road plan options                                                                                  |
| site         | [RoadSite](#struct-roadsite)             | optional                   | The road site model the plan was made from - its plan config                                           |

---

## Referenced Types

### struct AlignmentPoint

A road centerline alignment point

| Name | Type  | Attributes | Description                                                                      |
|------|-------|------------|----------------------------------------------------------------------------------|
| x    | float |            | The east coordinate                                                              |
| y    | float |            | The north coordinate                                                             |
| z    | float | optional   | The finished grade elevation of the centerline (default is the ground elevation) |

### struct CostRates

Cost rate overrides, in nominal US dollars per metric unit

| Name           | Type  | Attributes             | Description                                                                                                    |
|----------------|-------|------------------------|----------------------------------------------------------------------------------------------------------------|
| clearing       | float | optional<br>value >= 0 | Clearing and grubbing, per square meter of disturbed area                                                      |
| excavation     | float | optional<br>value >= 0 | Common excavation, per cubic meter (bank measure)                                                              |
| rockExcavation | float | optional<br>value >= 0 | Rock excavation, per cubic meter (bank measure)                                                                |
| embankment     | float | optional<br>value >= 0 | Embankment placement and compaction, per cubic meter                                                           |
| borrow         | float | optional<br>value >= 0 | Imported borrow fill, per cubic meter                                                                          |
| waste          | float | optional<br>value >= 0 | Excess excavation disposal, per cubic meter                                                                    |
| overhaul       | float | optional<br>value >= 0 | Overhaul beyond the free haul distance, per cubic meter-kilometer                                              |
| freeHaul       | float | optional<br>value >= 0 | The free haul distance, in meters                                                                              |
| shrink         | float | optional<br>value > 0  | The compacted fill volume per unit of common excavation (shrinkage)                                            |
| swell          | float | optional<br>value > 0  | The compacted fill volume per unit of rock excavation (swell)                                                  |
| native         | float | optional<br>value >= 0 | Native surface finish grading, per square meter                                                                |
| gravel         | float | optional<br>value >= 0 | Aggregate surfacing, per square meter                                                                          |
| asphalt        | float | optional<br>value >= 0 | Asphalt paving, per square meter                                                                               |
| concrete       | float | optional<br>value >= 0 | Concrete paving, per square meter                                                                              |
| drainage       | float | optional<br>value >= 0 | Roadside ditches and cross drains, per meter of road                                                           |
| culvert        | float | optional<br>value >= 0 | Culvert pipe, per meter of length per meter of diameter                                                        |
| culvertEnds    | float | optional<br>value >= 0 | Culvert inlet and outlet treatment, per culvert                                                                |
| retainingWall  | float | optional<br>value >= 0 | Retaining wall, per square meter of wall face                                                                  |
| bridge         | float | optional<br>value >= 0 | Bridge, per square meter of deck                                                                               |
| existingRoad   | float | optional<br>value >= 0 | Existing road upgrade (reshaping, a gravel lift, ditch cleaning, and minor widening), per square meter of road |
| erosionControl | float | optional<br>value >= 0 | Erosion control and revegetation, per square meter of disturbed area                                           |
| mobilization   | float | optional<br>value >= 0 | Mobilization, as a fraction of the other costs                                                                 |

### struct DesignCriteria

The road design criteria

| Name          | Type  | Attributes            | Description                                                                         |
|---------------|-------|-----------------------|-------------------------------------------------------------------------------------|
| maxGrade      | float | optional<br>value > 0 | The maximum road grade, in percent (default is 12)                                  |
| minRadius     | float | optional<br>value > 0 | The minimum centerline curve radius (default is 50 feet / 15 meters)                |
| rockCutSlope  | float | optional<br>value > 0 | The rock cut slope ratio, horizontal run per unit of vertical rise (default is 0.5) |
| maxWallHeight | float | optional<br>value > 0 | The maximum retaining wall height (default is 20 feet / 6 meters)                   |

### typedef ElevationRow

A row of grid elevations, west to east

| Type     | Attributes     |
|----------|----------------|
| float [] | len(array) > 1 |

### struct ElevationSource

An elevation data source

| Name | Type   | Attributes                 | Description                   |
|------|--------|----------------------------|-------------------------------|
| name | string | len(value) > 0             | The source's name             |
| date | string | optional<br>len(value) > 0 | The source's publication date |
| url  | string | optional<br>len(value) > 0 | The source's URL              |

### struct Feature

A topographic feature

| Name   | Type                             | Attributes                 | Description                                                                                                                                                                |
|--------|----------------------------------|----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| type   | [FeatureType](#enum-featuretype) |                            | The feature type                                                                                                                                                           |
| points | [Point](#struct-point) []        | len(array) > 1             | The feature's polyline (stream, road) or polygon (rock, exclusion) points                                                                                                  |
| name   | string                           | optional<br>len(value) > 0 | The feature name                                                                                                                                                           |
| added  | bool                             | optional                   | If true, the feature isn't the USGS's - it's one of the plan config's areas or roads, or the planning tools added it (and it's kept when the plan's site is created again) |

### enum FeatureType

A topographic feature type

| Value     | Description                                                                                                                  |
|-----------|------------------------------------------------------------------------------------------------------------------------------|
| stream    | A stream, drainage, or water course polyline - road crossings need a culvert or bridge                                       |
| rock      | A rock outcrop polygon - excavation within it is rock excavation                                                             |
| exclusion | An area polygon the road must avoid (building, wetland, property line, etc.)                                                 |
| road      | An existing road polyline - it's drawn, and the planning tools' route search may follow it (see the existing road structure) |
| trail     | An existing trail polyline - it's drawn, for reference                                                                       |

### struct Georeference

A road plan's georeference - its coordinate system's place on the Earth. The plan's coordinates are a
transverse Mercator map projection, with a scale factor of 1, centered on a latitude and longitude - so
"x" is the distance east and "y" is the distance north, in the plan's units.

| Name      | Type  | Attributes                    | Description                                           |
|-----------|-------|-------------------------------|-------------------------------------------------------|
| latitude  | float | value >= -90<br>value <= 90   | The projection center's latitude, in decimal degrees  |
| longitude | float | value >= -180<br>value <= 180 | The projection center's longitude, in decimal degrees |
| x         | float |                               | The projection center's east coordinate               |
| y         | float |                               | The projection center's north coordinate              |

### struct LatLong

A latitude and longitude

| Name      | Type  | Attributes                    | Description                                |
|-----------|-------|-------------------------------|--------------------------------------------|
| latitude  | float | value >= -90<br>value <= 90   | The latitude, in decimal degrees (WGS 84)  |
| longitude | float | value >= -180<br>value <= 180 | The longitude, in decimal degrees (WGS 84) |

### struct Point

A point in plan coordinates

| Name  | Type   | Attributes                 | Description          |
|-------|--------|----------------------------|----------------------|
| x     | float  |                            | The east coordinate  |
| y     | float  |                            | The north coordinate |
| label | string | optional<br>len(value) > 0 | The point label      |

### struct RoadOption

A road plan option

| Name        | Type                                        | Attributes     | Description                                                                                                                   |
|-------------|---------------------------------------------|----------------|-------------------------------------------------------------------------------------------------------------------------------|
| name        | string                                      | len(value) > 0 | The option name                                                                                                               |
| description | string []                                   | optional       | The option description Markdown text lines                                                                                    |
| section     | [RoadSection](#struct-roadsection)          |                | The road cross section                                                                                                        |
| alignment   | [AlignmentPoint](#struct-alignmentpoint) [] | len(array) > 1 | The road centerline alignment points, from the start point to the end point. Curves are represented by closely-spaced points. |
| structures  | [Structure](#struct-structure) []           | optional       | The special engineering structures                                                                                            |

### struct RoadSection

A road cross section

| Name      | Type                     | Attributes            | Description                                                                     |
|-----------|--------------------------|-----------------------|---------------------------------------------------------------------------------|
| width     | float                    | value > 0             | The finished road width, including shoulders                                    |
| cutSlope  | float                    | optional<br>value > 0 | The cut slope ratio, horizontal run per unit of vertical rise (default is 1)    |
| fillSlope | float                    | optional<br>value > 0 | The fill slope ratio, horizontal run per unit of vertical drop (default is 1.5) |
| surface   | [Surface](#enum-surface) | optional              | The road surface (default is "gravel")                                          |

### struct RoadSite

A road site - the start and end points of a road to plan, and its planning instructions. The site's
topography is USGS 3D Elevation Program lidar terrain, so the site is in the United States.

| Name        | Type                                     | Attributes            | Description                                                                                                                                                                                     |
|-------------|------------------------------------------|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| title       | string                                   | len(value) > 0        | The site title - it's the road plan's title                                                                                                                                                     |
| units       | [Units](#enum-units)                     |                       | The unit of the road plan's lengths and elevations                                                                                                                                              |
| start       | [SitePoint](#struct-sitepoint)           |                       | The road start point                                                                                                                                                                            |
| end         | [SitePoint](#struct-sitepoint)           |                       | The road end point                                                                                                                                                                              |
| notes       | string []                                | optional              | The planning instructions - the road's purpose, constraints, preferences, and anything else the road's engineer should know                                                                     |
| exclusions  | [SiteArea](#struct-sitearea) []          | optional              | The areas the road must avoid (buildings, wetlands, a neighbor's land, etc.)                                                                                                                    |
| roads       | [SiteLine](#struct-siteline) []          | optional              | The site's existing roads that the USGS doesn't map (a track, a driveway, etc.) - a road may follow them                                                                                        |
| passThrough | [SitePlace](#struct-siteplace) []        | optional              | The places the road must pass through - each has an option through it                                                                                                                           |
| criteria    | [DesignCriteria](#struct-designcriteria) | optional              | The road design criteria                                                                                                                                                                        |
| costRates   | [CostRates](#struct-costrates)           | optional              | The cost rate overrides                                                                                                                                                                         |
| margin      | float                                    | optional<br>value > 0 | The distance the site's topography extends beyond the start and end points, in the plan's units (default is 30% of the distance between the points, from 500 to 2,000 feet / 150 to 600 meters) |
| spacing     | float                                    | optional<br>value > 0 | The topography grid spacing, in the plan's units (default is the finest spacing that keeps the grid within its size limit)                                                                      |

### enum Side

A side of the road

| Value |
|-------|
| left  |
| right |
| both  |

### struct SiteArea

An area of the site

| Name   | Type                           | Attributes                 | Description                                                                                |
|--------|--------------------------------|----------------------------|--------------------------------------------------------------------------------------------|
| name   | string                         | optional<br>len(value) > 0 | The area name                                                                              |
| points | [LatLong](#struct-latlong) []  | len(array) > 2             | The area's polygon points                                                                  |
| found  | [SiteFound](#struct-sitefound) | optional                   | How a plan's run found the area from the notes - an area without it is the plan's author's |

### struct SiteFound

How a plan's run found an area or a place of the site from its notes

| Name  | Type   | Attributes                 | Description                                                                            |
|-------|--------|----------------------------|----------------------------------------------------------------------------------------|
| place | string | len(value) > 0             | The notes' place - its name                                                            |
| model | string | optional<br>len(value) > 0 | The model that found it on the site's map - without it, its coordinates are the notes' |
| why   | string | optional                   | What the model saw there                                                               |

### struct SiteLine

A line of the site

| Name   | Type                          | Attributes                 | Description       |
|--------|-------------------------------|----------------------------|-------------------|
| name   | string                        | optional<br>len(value) > 0 | The line name     |
| points | [LatLong](#struct-latlong) [] | len(array) > 1             | The line's points |

### struct SitePlace

A place of the site

| Name      | Type                           | Attributes                    | Description                                                                                 |
|-----------|--------------------------------|-------------------------------|---------------------------------------------------------------------------------------------|
| name      | string                         | optional<br>len(value) > 0    | The place name                                                                              |
| latitude  | float                          | value >= -90<br>value <= 90   | The place's latitude, in decimal degrees (WGS 84)                                           |
| longitude | float                          | value >= -180<br>value <= 180 | The place's longitude, in decimal degrees (WGS 84)                                          |
| found     | [SiteFound](#struct-sitefound) | optional                      | How a plan's run found the place from the notes - a place without it is the plan's author's |

### struct SitePoint

A road start or end point

| Name        | Type   | Attributes                    | Description                                                                                                          |
|-------------|--------|-------------------------------|----------------------------------------------------------------------------------------------------------------------|
| latitude    | float  | value >= -90<br>value <= 90   | The point's latitude, in decimal degrees (WGS 84) - north is positive                                                |
| longitude   | float  | value >= -180<br>value <= 180 | The point's longitude, in decimal degrees (WGS 84) - east is positive, so the United States' longitudes are negative |
| label       | string | optional<br>len(value) > 0    | The point label (default is "Start" or "End")                                                                        |
| description | string | optional<br>len(value) > 0    | The point's description - what is there, and how the road joins it                                                   |

### struct Structure

A special engineering structure. Stations are distances along the road centerline from the
first alignment point.

| Name       | Type                                 | Attributes                 | Description                                                                                                                           |
|------------|--------------------------------------|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| type       | [StructureType](#enum-structuretype) |                            | The structure type                                                                                                                    |
| station    | float                                | value >= 0                 | The structure's station (starting station for walls, bridges, turnouts, and existing roads)                                           |
| endStation | float                                | optional<br>value >= 0     | The structure's ending station (required for walls, bridges, turnouts, and existing roads)                                            |
| side       | [Side](#enum-side)                   | optional                   | The side of the road, facing from the start toward the end (walls and turnouts, default is "both" for walls and "right" for turnouts) |
| diameter   | float                                | optional<br>value > 0      | The culvert pipe diameter (default is 1.5 feet / 0.45 meters)                                                                         |
| name       | string                               | optional<br>len(value) > 0 | The structure name                                                                                                                    |

### enum StructureType

A special engineering structure type

| Value         | Description                                                                                                                                                                                                                                                         |
|---------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| retainingWall | A retaining wall supports a fill or cut where the side slope is too steep to daylight                                                                                                                                                                               |
| bridge        | A bridge spans a stream or ravine - there is no earthwork within the span                                                                                                                                                                                           |
| culvert       | A culvert carries a stream or ditch water under the road                                                                                                                                                                                                            |
| turnout       | A turnout widens a single-lane road for passing (10 feet / 3 meters)                                                                                                                                                                                                |
| existingRoad  | The option follows an existing road - it's costed at the existing road upgrade rate, with no earthwork or clearing. Its as-built grade follows the ground (alignment elevations within it are ignored), and its grade, curves, and stream crossings aren't checked. |

### enum Surface

A road surface type

| Value    |
|----------|
| native   |
| gravel   |
| asphalt  |
| concrete |

### struct Topography

A site topography elevation grid. The grid's southwest corner is the origin of the plan's
coordinate system - "x" increases to the east and "y" increases to the north.

| Name            | Type                                          | Attributes            | Description                                                                                                                                                                                                                             |
|-----------------|-----------------------------------------------|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| spacing         | float                                         | value > 0             | The distance between adjacent grid points                                                                                                                                                                                               |
| elevations      | [ElevationRow](#typedef-elevationrow) []      | len(array) > 1        | The elevation grid rows, ordered north to south (top to bottom of the map). Each row's elevations are ordered west to east. The elevation at row "r" and column "c" is located at x = c * spacing and y = (rowCount - 1 - r) * spacing. |
| contourInterval | float                                         | optional<br>value > 0 | The contour interval for display (default is computed from the elevation range)                                                                                                                                                         |
| features        | [Feature](#struct-feature) []                 | optional              | The site's topographic features                                                                                                                                                                                                         |
| sources         | [ElevationSource](#struct-elevationsource) [] | optional              | The elevation grid's data sources, in order of precedence                                                                                                                                                                               |

### enum Units

A linear unit

| Value  |
|--------|
| feet   |
| meters |
