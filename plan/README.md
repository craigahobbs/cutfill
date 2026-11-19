# SageRoad Planning Tools

The SageRoad road planning tools - they build a road's site from USGS lidar terrain and engineer its road options. The
SageRoad application ([../app/](../app/README.md)) runs them in the browser. The tools are JavaScript (ES modules in
`lib/`) built with [javascript-build](https://github.com/craigahobbs/javascript-build#readme), and they use the
[SageRoad viewer](../viewer/README.md)'s road plan model. See the project's [README](../README.md).

`bin/plan.js` is the tools' command line, for their development - it checks the tools against the USGS's services,
and compares their plans when they change. It doesn't ask a model. Every command has a `-h` argument.

```sh
node bin/plan.js auto <site.json> <plan.json>    # plan a road by procedure - as the application's run does
node bin/plan.js site <site.json> <plan.json>    # create a plan's site from a road site model - its lidar terrain
node bin/plan.js options <plan.json>             # engineer the plan's standard options, in cost score order
node bin/plan.js route <plan.json> -n NAME       # engineer a road option - its alignment, profile, and structures
```


## A plan's run

`auto` plans a road by procedure (`lib/auto.js`'s `autoPlan`) - the application's run (`lib/browser/io.js`'s
`planRoad`). Its steps are its code's, in order: the site, the notes' directives (with a model), the notes' places
(the plan config's marks), the standard options and an option through each place to pass through (with the unmapped
draws they cross added as streams, until they cross none - `lib/draws.js`), another corridor (once the other options
cross no unmapped draws - if it's an option that crosses any, they're added and the options are engineered again), the
options it keeps (the best first), and the descriptions (`lib/draft.js`'s, with what the run did). If the Existing
Roads or New Road option is at the site's edge, or there's no road within the grade limit, the plan config's margin
is enlarged by half and the site is created again (at most twice). The run's plan config changes when its marks or
its margin do - the plan keeps it (its `site` member), so the application's loaded plan's config is the run's, and
the command line writes its file.

A run makes its plan in memory: the tools' functions take a plan and change it or return one (`createSite`,
`standardOptions`, `corridorOption`, `engineerOption`, `keepOptions`, `addDraws`, `describePlan`), and a plan is
read and written only by the command line's commands (`lib/cli.js` - it's the one module that parses arguments, and
it isn't the browser's) and the application's page. The plan a run returns is in the model's order - its site's plan
is validated, and what the tools add to it is made in that order. A run's files are its work directory's (the
terrain cache, the model's saved answers, and the plots a model was asked of) and its map image. A terrain's draws,
and a topography's route lattices (one with its existing roads, and one without), are found once and kept, so a
run's options share them.

A model doesn't run the plan: it's asked questions (`lib/ollama.js`, Ollama's chat API), each a paragraph and at most
one image, each answered with a JSON object of the question's schema that `auto` checks. The notes question's answer
is the notes' directives - the road's width and surface, a maximum grade and minimum radius (the plan config's own
criteria win), a bridge's fill depth, the existing roads to rule out (`options` and `route` don't follow them -
`--rule-out` - and they stay the plan's roads, so a plan that's made again is made the same), the places to avoid
and to pass through (and the coordinates the notes give for them), and the notes it doesn't cover (they're reported,
and they're in the plan's limitations). A place's coordinates are used only if each number is one of the notes'. A
place without coordinates is found on the site's map: the model is shown a plot of the map with the plan's
coordinates' grid (`lib/plot.js`), and its answer is a rectangle - which the model corrects on a closer look - or a
point. A rectangle that contains the start or end point is cut back from it by the minimum radius, and one that covers
more than a quarter of the site isn't a place. The questions are asked without thinking, with a limited answer: a
local model that thinks about an image may think for minutes, and a request that's abandoned keeps the model busy.

A place that's found is one of the plan config's marks - an exclusion area, or a place to pass through - with how it
was found (its `found` member: the notes' place, and the model and what it saw there). A place that has a mark (one
found for it, or the author's mark of its name) isn't found again, and a mark that was found for a place the notes
don't name any more is removed (`--fresh` finds them again). The model's answers are saved in the work directory
(`decisions.json`) - the notes' answer while the notes and the model are the same, and a place's while the site's
grid is the same, too - so a place it didn't find isn't asked again.

`lib/browser/` is the tools in a web browser, for the SageRoad application's page: `io.js` is the tools' input and
output functions there - files in memory, the USGS's services, its elevation models, and Ollama by `fetch`, and a
plot's PNG image by a canvas - and `planRoad`, which runs a plan config with `autoPlan` and returns the road plan, its
map image a data URL (a run of the same site keeps the plan's site data and the features that were added to it - its
options are the run's - and an abort signal stops it). `buffer.js` and `zlib.js` are the Node modules the tools
import (a buffer's base64 text, and `crc32` and `deflateSync`) - the page's import map names them. `auto` reports what it's doing - its step's key (`autoSteps`) and text - to the input and output functions'
`status` function, if they have it.


## The site

A road site model (a plan config - a JSON file, of any name) is a road's start and end points, as latitudes and
longitudes, and its planning instructions - the plan keeps it (its `site` member), and a plan's design criteria and
cost rates are its site's. An existing plan must be the site's - the same points and units - and `site` says so
before it fetches anything. Run on a plan whose grid is the site's (the same margin and spacing, too), `site` keeps
the plan's site data - its terrain, streams, roads, trails, and map - and only updates its title, labels, marks,
criteria, and cost rates (`--fetch` fetches it again). If there's no site file, `site` writes it from the plan's own
site model. Otherwise, `site` finds the USGS 3D Elevation Program's 1 meter elevation models of the site (lidar
ground elevations), reads the site's part of them (it's cached in the plan's work directory,
`<plan>.work/terrain/`), and grids them in the plan's coordinates - a transverse Mercator projection centered on
the site. The newest survey's elevations are used, and an older survey's where the newer have none.

The site's features are the USGS National Map's streams, roads, and trails, the plan config's exclusion areas and
roads (its marks - `added` features), and its topographic map image (`<plan>.png`) is the National Map's. The
streams were mapped at a coarser scale than the terrain, so each is moved to the bottom of its valley - the lowest
ground within 30 meters across it. The roads (the National Map's highways, local roads, and four-wheel-drive roads,
and the plan config's) are existing roads that a road option may follow - its trails are for reference. `site` on
an existing plan creates its site again (a larger site, a finer grid): the plan's options are kept, and its features
that aren't the site's - its rock outcrops, its other exclusion areas, and the draws that were added - in the new
grid's coordinates.

An elevation model is a GeoTIFF file - a grid of elevations, and where it is - of 100 megabytes or more, so only the
parts of it that a site needs are fetched (HTTP range requests). The tools read it themselves
(`lib/elevationImage.js`), in Node and in a browser: the USGS's 1 meter models are of one form - a little-endian TIFF
file of 32-bit floating point elevations, in LZW-compressed tiles, with no predictor, the horizontal predictor, or the
floating point predictor - and the reader is that form's alone (a model of another form is an error that says so).
A file's header and tags are one request, and a window's tiles are a request for each row of tiles.

A site's draws are the valleys of its terrain that carry water in a storm, which a road crosses with a culvert
(`lib/draws.js`). The terrain's hollows are filled (a road's fill across a valley is one - its culvert isn't in the
terrain), each grid point drains to its steepest neighbor below it, and a draw is the line of points that drain at
least an area - 3 acres (1.2 hectares). A draw's area is the site's ground that drains to it.


## The road options

`options` engineers a plan's standard options - `route`'s road ("Existing Roads", if it follows any of the plan's
existing roads), `route --all-new`'s ("New Road"), and another corridor - and puts the plan's options in cost score
order. The options of those names are replaced, so it's run again after the plan's features or criteria change.

Another corridor is the least-cost road outside a band around the other standard options' middles (their middle 60%
- its half-width is a twentieth of the distance between the start and end points, at least four minimum radii, and
the points are outside it). Its road's middle point is its via point, and its option is `route`'s road through the via
point (without the band, and with one grade penalty weight, 0.5), named for its middle's side of the least-cost road's
middle ("West Corridor"). It's kept if
it's a real choice: it's within the grade limit, it doesn't turn back at its via point, its middle is an average of
the band's half-width from the other standard options, at least, and it costs at most three times the least-cost
standard option. If it isn't kept, `options` says why, and the plan's description does, too.

`route` searches for the least-cost horizontal alignment on a lattice with heading states (so its turns have the
minimum radius), designs the vertical profile by dynamic programming (the minimum earthwork cost within the grade
limits, within the maximum cut and fill depth of the ground), and places the structures (`lib/route.js`,
`lib/profile.js`, `lib/structures.js`). The search's penalty for ground that's steeper than the design grade stands
in for the earthwork a road needs there - it isn't a cost, so no one weight of it is right. A route is searched with
three weights (1, 0.5, and 0.25), each search's road is designed, and the route's road is the one with the lowest
cost score - it's never worse than the first weight's road, by its cost score or its design warnings
(`--grade-weight` searches with one weight). It's a port of the project's first planning tools, which were Python (they
digitized a topographic map image) - their results are the engineering tests' expectations
(`test/expected/pythonTools.json`).

The route search follows the plan's existing roads (its `road` features, `lib/roads.js`) where that costs less than
a new road: a move along an existing road costs its length's upgrade, with no earthwork, grade limit, or culvert,
and it turns as the road does. The route's runs along existing roads are the roads' lines and the option's
`existingRoad` structures - from the minimum radius after the route joins a road to the minimum radius before it
leaves it, so a junction's curve is new road. `--all-new` searches for an all-new road.

A road is within its grade limit. Where a route's profile can't be - at the design grade, it can't reach the end
point's ground, or an existing road's - `route` searches again with stricter grades, and if there's still no road,
it's an error and no option is written.

`route` reports the option's existing roads (and their grades as they're built, which aren't designed), structure
counts, cost score, and design warning count - and notes a road within its minimum radius of the site's edge (the
site may be too small for the best route), a via point that the road turns back at (the straight line between the
road's points 10 minimum radii before and after the via point is less than half their distance along the road), and
the unmapped draws that the road crosses - a draw that isn't a stream of the plan has no culvert there.

The descriptions' draft (`lib/draft.js`) has the facts the tools know: the site's points and criteria, the features
that were added, and each option's length, grades, existing roads (and their grades as they're built), structures,
earthwork, largest cost items, and largest cost differences from the least-cost option. A run adds what it did with
the notes.
